import { CacheCreate } from '../cache/lru'; // Import this appropriately, I made an assumption here.
import { User as UserType } from './UserTypes'; // Assuming you have some kind of User type

export class UserBlocks {
    private static _cache = cacheCreate({
        name: 'user:blocks',
        max: 100,
        ttl: 0,
    });

    public static async is(targetUid: number, uids: number[] | number): Promise<boolean | boolean[]> {
        const isArray = Array.isArray(uids);
        uids = isArray ? uids : [uids];
        const blocks = await this.list(uids);
        const isBlocked = uids.map((uid, index) => blocks[index] && blocks[index].includes(targetUid));
        return isArray ? isBlocked : isBlocked[0];
    }

    public static async can(callerUid: number, blockerUid: number, blockeeUid: number, type: string): Promise<void> {
        if (blockerUid === 0 || blockeeUid === 0) {
            throw new Error('[[error:cannot-block-guest]]');
        } else if (blockerUid === blockeeUid) {
            throw new Error('[[error:cannot-block-self]]');
        }

        const [isCallerAdminOrMod, isBlockeeAdminOrMod] = await Promise.all([
            UserType.isAdminOrGlobalMod(callerUid), // Assuming UserType has these methods
            UserType.isAdminOrGlobalMod(blockeeUid),
        ]);
        
        if (isBlockeeAdminOrMod && type === 'block') {
            throw new Error('[[error:cannot-block-privileged]]');
        }
        if (callerUid !== blockerUid && !isCallerAdminOrMod) {
            throw new Error('[[error:no-privileges]]');
        }
    }
    
    private static async list(uids: number[] | number): Promise<any[]> {
        // Your list implementation here
        return [];
    }
}
// translation up to line 43 in the blocks.js file
// Usage in User.ts or wherever you want to use this class
// import { UserBlocks } from './UserBlocks';
