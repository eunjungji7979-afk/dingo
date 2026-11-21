# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants
1. **Room Ownership**: A `Room` can only be created when `teacherUid == request.auth.uid` and `request.auth.token.email_verified == true`. `teacherUid` and `createdAt` are immutable. Once `status == 'ENDED'`, the room is locked against further updates.
2. **Master Gate Integrity**: No `DingoCard`, `DingoGroup`, or `GroupPlayer` document can exist without a valid parent `Room` document.
3. **Host/Student Turn Boundaries**:
   - Only `hostPlayerId` (or `teacherUid`) can transition a group from `VIEWING` to `DISCARDING` ("버려!") or from `DISCARDING` to `PICKING` ("집어!").
   - Only an active player in `activePlayerIds` (or `teacherUid`) can claim a center slot in `PICKING` or declare `DINGO_WON` ("딩고!").
   - Reshuffling player hands by a student host/winner is only allowed atomically (`getAfter`) during the transition from `DINGO_WON` to `VIEWING`.
4. **No Shadow Fields / Type Poisoning**: Every write passes strict `keys().hasAll(...)` + `keys().hasOnly(...)` + `.size()` boundary checks and server `request.time` timestamp validation.
5. **Query Enforcer**: All `allow list` rules evaluate `resource.data` directly without `get()`/`exists()` lookups.

## 2. The "Dirty Dozen" Attack Payloads (All Must Fail with `PERMISSION_DENIED`)
1. **Unauthenticated Room Create**: `request.auth == null` creating `/rooms/ABC123`.
2. **Unverified Email Create**: `email_verified == false` creating `/rooms/ABC123`.
3. **Teacher UID Spoofing**: Authenticated user `U1` creating `/rooms/ABC123` with `teacherUid: "U2"`.
4. **Shadow Field Injection**: Creating a `Room` with an extra ghost key `isAdmin: true`.
5. **Oversized ID Poisoning**: Creating `/rooms/<150-char-id>` violating `isValidRoomCode`.
6. **Client Timestamp Forgery**: Creating/updating a document with a past/future `createdAt` or `updatedAt != request.time`.
7. **Orphaned Card Write**: Creating `/rooms/NONEXISTENT/cards/0`.
8. **Student Mutating Immutable Room Fields**: Non-teacher updating `rooms/{roomId}` `totalGroups` or `status`.
9. **Non-Host Triggering "버려!"**: A non-host student updating `groups/{groupId}` `phase` from `VIEWING` to `DISCARDING`.
10. **Non-Active Spectator Claiming Center Card**: A user not in `activePlayerIds` updating `centerClaimedBy`.
11. **Terminal State Violation**: Updating a `Room` whose `status` is already `'ENDED'`.
12. **Blanket List Scraping**: Listing `/rooms` without filtering `where('teacherUid', '==', uid)`.
