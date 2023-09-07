// Have received the help of online js to ts converter, chatGPT
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const database_1 = __importDefault(require("../database"));
const plugins_1 = __importDefault(require("../plugins"));
const lru_1 = __importDefault(require("../cache/lru"));
function default_1(User) {
    User.blocks = {
        _cache: (0, lru_1.default)({
            name: 'user:blocks',
            max: 100,
            ttl: 0,
        }),
        is: (targetUid, uids) => __awaiter(this, void 0, void 0, function* () {
            const isArray = Array.isArray(uids);
            const uidsArray = isArray ? uids : [uids];
            const blocks = (yield User.blocks.list(uidsArray));
            const isBlocked = uidsArray.map((uid, index) => blocks[index].includes(parseInt(targetUid.toString(), 10)));
            return isArray ? isBlocked : isBlocked[0];
        }),
        can: (callerUid, blockerUid, blockeeUid, type) => __awaiter(this, void 0, void 0, function* () {
            if (blockerUid === 0 || blockeeUid === 0) {
                throw new Error('[[error:cannot-block-guest]]');
            }
            else if (blockerUid === blockeeUid) {
                throw new Error('[[error:cannot-block-self]]');
            }
            const [isCallerAdminOrMod, isBlockeeAdminOrMod] = yield Promise.all([
                User.isAdminOrGlobalMod(callerUid),
                User.isAdminOrGlobalMod(blockeeUid),
            ]);
            if (isBlockeeAdminOrMod && type === 'block') {
                throw new Error('[[error:cannot-block-privileged]]');
            }
            if (parseInt(callerUid.toString(), 10) !== parseInt(blockerUid.toString(), 10) && !isCallerAdminOrMod) {
                throw new Error('[[error:no-privileges]]');
            }
        }),
        list: (uids) => __awaiter(this, void 0, void 0, function* () {
            const isArray = Array.isArray(uids);
            let uidsArray = isArray ? uids : [uids];
            uidsArray = uidsArray.map(uid => parseInt(uid.toString(), 10));
            const cachedData = {};
            const unCachedUids = User.blocks._cache.getUnCachedKeys(uidsArray, cachedData);
            if (unCachedUids.length) {
                const unCachedData = yield database_1.default.getSortedSetsMembers(unCachedUids.map(uid => `uid:${uid}:blocked_uids`));
                unCachedUids.forEach((uid, index) => {
                    cachedData[uid] = (unCachedData[index] || []).map(uid => parseInt(uid.toString(), 10));
                    User.blocks._cache.set(uid, cachedData[uid]);
                });
            }
            const result = uidsArray.map(uid => cachedData[uid] || []);
            return isArray ? result : [result[0]]; // Always return an array of arrays.
        }),
        add: (targetUid, uid) => __awaiter(this, void 0, void 0, function* () {
            yield User.blocks.applyChecks('block', targetUid, uid);
            yield database_1.default.sortedSetAdd(`uid:${uid}:blocked_uids`, Date.now(), targetUid);
            yield User.incrementUserFieldBy(uid, 'blocksCount', 1);
            User.blocks._cache.del(uid.toString());
            plugins_1.default.hooks.fire('action:user.blocks.add', { uid: uid, targetUid: targetUid });
        }),
        remove: (targetUid, uid) => __awaiter(this, void 0, void 0, function* () {
            yield User.blocks.applyChecks('unblock', targetUid, uid);
            yield database_1.default.sortedSetRemove(`uid:${uid}:blocked_uids`, targetUid);
            yield User.decrementUserFieldBy(uid, 'blocksCount', 1);
            User.blocks._cache.del(uid.toString());
            plugins_1.default.hooks.fire('action:user.blocks.remove', { uid: uid, targetUid: targetUid });
        }),
        applyChecks: (type, targetUid, uid) => __awaiter(this, void 0, void 0, function* () {
            yield User.blocks.can(uid, uid, targetUid, type);
            const isBlock = type === 'block';
            const is = yield User.blocks.is(targetUid, uid);
            if (is === isBlock) {
                throw new Error(`[[error:already-${isBlock ? 'blocked' : 'unblocked'}]]`);
            }
        }),
        filterUids: (targetUid, uids) => __awaiter(this, void 0, void 0, function* () {
            const isBlocked = yield User.blocks.is(targetUid, uids);
            return uids.filter((uid, index) => !isBlocked[index]);
        }),
        filter: (uid, property, set) => __awaiter(this, void 0, void 0, function* () {
            if (Array.isArray(property) && typeof set === 'undefined') {
                set = property;
                property = 'uid';
            }
            if (!Array.isArray(set) || !set.length) {
                return set;
            }
            const isPlain = typeof set[0] !== 'object';
            const blocked_uids = yield User.blocks.list(uid);
            let flat_blocked_uids = [];
            for (let i = 0; i < blocked_uids.length; i++) {
                flat_blocked_uids = flat_blocked_uids.concat(blocked_uids[i]);
            }
            const blockedSet = new Set(flat_blocked_uids);
            const resultSet = set.filter(item => !blockedSet.has(parseInt(typeof item === 'object' ? item[property] : item, 10)));
            const data = yield plugins_1.default.hooks.fire('filter:user.blocks.filter', { set: resultSet, property: property, uid: uid, blockedSet: blockedSet });
            return data.set;
        }),
    };
}
exports.default = default_1;
