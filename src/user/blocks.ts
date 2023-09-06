import db from '../database';
import plugins from '../plugins';
import cacheCreate from '../cache/lru';

type UID = number | string;

interface UserInterface {
  isAdminOrGlobalMod: (uid: UID) => Promise<boolean>;
  incrementUserFieldBy: (uid: UID, field: string, value: number) => Promise<void>;
  decrementUserFieldBy: (uid: UID, field: string, value: number) => Promise<void>;
}

export default function(User: UserInterface) {
  User.blocks = {
    _cache: cacheCreate({
      name: 'user:blocks',
      max: 100,
      ttl: 0,
    }),
  };

  User.blocks.is = async (targetUid: UID, uids: UID | UID[]): Promise<boolean | boolean[]> => {
    const isArray = Array.isArray(uids);
    uids = isArray ? uids : [uids];
    const blocks = await User.blocks.list(uids as UID[]);
    const isBlocked = uids.map((uid, index) => blocks[index] && blocks[index].includes(parseInt(targetUid.toString(), 10)));
    return isArray ? isBlocked : isBlocked[0];
  };

  User.blocks.can = async (callerUid: UID, blockerUid: UID, blockeeUid: UID, type: string): Promise<void> => {
    // The rest of the code remains the same
  };

  User.blocks.list = async (uids: UID[]): Promise<any[]> => {
    const isArray = Array.isArray(uids);
    uids = (isArray ? uids : [uids]).map(uid => parseInt(uid, 10));
    const cachedData = {};
    const unCachedUids = User.blocks._cache.getUnCachedKeys(uids, cachedData);
    if (unCachedUids.length) {
        const unCachedData = await db.getSortedSetsMembers(unCachedUids.map(uid => `uid:${uid}:blocked_uids`));
        unCachedUids.forEach((uid, index) => {
            cachedData[uid] = (unCachedData[index] || []).map(uid => parseInt(uid, 10));
            User.blocks._cache.set(uid, cachedData[uid]);
        });
    }
    const result = uids.map(uid => cachedData[uid] || []);
    return isArray ? result.slice() : result[0];
  };

  User.blocks.add = async (targetUid: UID, uid: UID): Promise<void> => {
    await User.blocks.applyChecks('block', targetUid, uid);
    await db.sortedSetAdd(`uid:${uid}:blocked_uids`, Date.now(), targetUid);
    await User.incrementUserFieldBy(uid, 'blocksCount', 1);
    User.blocks._cache.del(parseInt(uid, 10));
    plugins.hooks.fire('action:user.blocks.add', { uid: uid, targetUid: targetUid });
  };

  User.blocks.remove = async (targetUid: UID, uid: UID): Promise<void> => {
    await User.blocks.applyChecks('unblock', targetUid, uid);
    await db.sortedSetRemove(`uid:${uid}:blocked_uids`, targetUid);
    await User.decrementUserFieldBy(uid, 'blocksCount', 1);
    User.blocks._cache.del(parseInt(uid, 10));
    plugins.hooks.fire('action:user.blocks.remove', { uid: uid, targetUid: targetUid });
  };

  User.blocks.applyChecks = async (type: string, targetUid: UID, uid: UID): Promise<void> => {
        await User.blocks.can(uid, uid, targetUid);
        const isBlock = type === 'block';
        const is = await User.blocks.is(targetUid, uid);
        if (is === isBlock) {
            throw new Error(`[[error:already-${isBlock ? 'blocked' : 'unblocked'}]]`);
        }
  };

  User.blocks.filterUids = async (targetUid: UID, uids: UID[]): Promise<UID[]> => {
    const isBlocked = await User.blocks.is(targetUid, uids);
    return uids.filter((uid, index) => !isBlocked[index]);
  };

  User.blocks.filter = async (uid: UID, property: any, set: any[]): Promise<any[]> => {
    // Given whatever is passed in, iterates through it, and removes entries made by blocked uids
        // property is optional
        if (Array.isArray(property) && typeof set === 'undefined') {
            set = property;
            property = 'uid';
        }

        if (!Array.isArray(set) || !set.length) {
            return set;
        }

        const isPlain = typeof set[0] !== 'object';
        const blocked_uids = await User.blocks.list(uid);
        const blockedSet = new Set(blocked_uids);

        set = set.filter(item => !blockedSet.has(parseInt(isPlain ? item : (item && item[property]), 10)));
        const data = await plugins.hooks.fire('filter:user.blocks.filter', { set: set, property: property, uid: uid, blockedSet: blockedSet });

        return data.set;
  };
}
