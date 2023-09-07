// Have received the help of online js to ts converter, chatGPT



import database from '../database';
import plugins from '../plugins';
import lru from '../cache/lru';

interface User {
  blocks: {
    _cache: lru;
    is: (targetUid: number, uids: number[] | number) => Promise<boolean | boolean[]>;
    can: (callerUid: number, blockerUid: number, blockeeUid: number, type: string) => Promise<void>;
    list: (uids: number[] | number) => Promise<number[] | number[][]>;
    add: (targetUid: number, uid: number) => Promise<void>;
    remove: (targetUid: number, uid: number) => Promise<void>;
    applyChecks: (type: string, targetUid: number, uid: number) => Promise<void>;
    filterUids: (targetUid: number, uids: number[]) => Promise<number[]>;
    filter: (uid: number, property?: string | string[], set?: any[]) => Promise<any[]>;
  };
  isAdminOrGlobalMod: (uid: number) => Promise<boolean>;
  incrementUserFieldBy: (uid: number, field: string, value: number) => Promise<void>;
  decrementUserFieldBy: (uid: number, field: string, value: number) => Promise<void>;
}

export default function (User: User): void {
    User.blocks = {
        _cache: lru({
            name: 'user:blocks',
            max: 100,
            ttl: 0,
        }),
        is: async (targetUid, uids) => {
            const isArray = Array.isArray(uids);
            const uidsArray = isArray ? uids : [uids];
            const blocks = (await User.blocks.list(uidsArray)) as number[][];
            const isBlocked = uidsArray.map((uid, index) => blocks[index].includes(parseInt(targetUid.toString(), 10)));
            return isArray ? isBlocked : isBlocked[0];
        },
        can: async (callerUid, blockerUid, blockeeUid, type) => {
            if (blockerUid === 0 || blockeeUid === 0) {
                throw new Error('[[error:cannot-block-guest]]');
            } else if (blockerUid === blockeeUid) {
                throw new Error('[[error:cannot-block-self]]');
            }
            const [isCallerAdminOrMod, isBlockeeAdminOrMod] = await Promise.all([
                User.isAdminOrGlobalMod(callerUid),
                User.isAdminOrGlobalMod(blockeeUid),
            ]);
            if (isBlockeeAdminOrMod && type === 'block') {
                throw new Error('[[error:cannot-block-privileged]]');
            }
            if (parseInt(callerUid.toString(), 10) !== parseInt(blockerUid.toString(), 10) && !isCallerAdminOrMod) {
                throw new Error('[[error:no-privileges]]');
            }
        },
        list: async (uids) => {
            const isArray = Array.isArray(uids);
            let uidsArray = isArray ? uids : [uids];
            uidsArray = uidsArray.map(uid => parseInt(uid.toString(), 10));

            const cachedData = {};
            const unCachedUids = User.blocks._cache.getUnCachedKeys(uidsArray, cachedData);

            if (unCachedUids.length) {
                const unCachedData = await database.getSortedSetsMembers(unCachedUids.map(uid => `uid:${uid}:blocked_uids`));
                unCachedUids.forEach((uid, index) => {
                    cachedData[uid] = (unCachedData[index] || []).map(uid => parseInt(uid.toString(), 10));
                    User.blocks._cache.set(uid, cachedData[uid]);
                });
            }

            const result = uidsArray.map(uid => cachedData[uid] || []);
            return isArray ? result : [result[0]]; // Always return an array of arrays.
        },
        add: async (targetUid, uid) => {
            await User.blocks.applyChecks('block', targetUid, uid);
            await database.sortedSetAdd(`uid:${uid}:blocked_uids`, Date.now(), targetUid);
            await User.incrementUserFieldBy(uid, 'blocksCount', 1);
            User.blocks._cache.del(uid.toString());
            plugins.hooks.fire('action:user.blocks.add', { uid: uid, targetUid: targetUid });
        },
        remove: async (targetUid, uid) => {
            await User.blocks.applyChecks('unblock', targetUid, uid);
            await database.sortedSetRemove(`uid:${uid}:blocked_uids`, targetUid);
            await User.decrementUserFieldBy(uid, 'blocksCount', 1);
            User.blocks._cache.del(uid.toString());
            plugins.hooks.fire('action:user.blocks.remove', { uid: uid, targetUid: targetUid });
        },
        applyChecks: async (type, targetUid, uid) => {
            await User.blocks.can(uid, uid, targetUid, type);
            const isBlock = type === 'block';
            const is = await User.blocks.is(targetUid, uid);
            if (is === isBlock) {
                throw new Error(`[[error:already-${isBlock ? 'blocked' : 'unblocked'}]]`);
            }
        },
        filterUids: async (targetUid, uids) => {
            const isBlocked = await User.blocks.is(targetUid, uids);
            return uids.filter((uid, index) => !isBlocked[index]);
        },
        filter: async (uid, property, set) => {
            if (Array.isArray(property) && typeof set === 'undefined') {
                set = property;
                property = 'uid';
            }
            if (!Array.isArray(set) || !set.length) {
                return set;
            }
            const isPlain = typeof set[0] !== 'object';
            const blocked_uids = await User.blocks.list(uid);
            let flat_blocked_uids: number[] = [];
            for (let i = 0; i < blocked_uids.length; i++) {
                flat_blocked_uids = flat_blocked_uids.concat(blocked_uids[i]);
            }
            const blockedSet = new Set<number>(flat_blocked_uids);
            const resultSet = set.filter(item => !blockedSet.has(parseInt(typeof item === 'object' ? item[property as keyof typeof item] : item, 10)));
            const data = await plugins.hooks.fire('filter:user.blocks.filter', { set: resultSet, property: property, uid: uid, blockedSet: blockedSet });
            return data.set;
        },
    };
}
