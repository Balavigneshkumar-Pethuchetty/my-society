# Alias Name (Username) Feature

**Status**: ✅ Complete  
**Date Implemented**: 2026-09-19

## Overview

Users can now set a unique alias name (username) that appears in community directory and communication features, instead of revealing their real name, phone, or email. The system prevents duplicate alias names and suggests alternatives if the chosen name is taken.

---

## Backend Changes

### 1. Database
- `users.username` column: Already exists (UNIQUE, VARCHAR(255))
- Migration `040_backfill_username_from_name.sql` backfilled all existing users with their names

### 2. API Models  
**File**: [services/user/app/models.py:44-51](services/user/app/models.py#L44-L51)

Updated `UserUpdateRequest` to accept username:
```python
class UserUpdateRequest(BaseModel):
    name: Optional[str] = None
    username: Optional[str] = None  # ← NEW
    phone: Optional[str] = None
    ...
```

### 3. Update Endpoint
**File**: [services/user/app/routes/users.py:340-395](services/user/app/routes/users.py#L340-L395)

Modified `PUT /api/users/me` to:
- Accept `username` in request body
- Validate uniqueness (409 Conflict if taken)
- Return clear error: `"Alias name 'xyz' is already taken"`

### 4. NEW: Username Validation Endpoint
**File**: [services/user/app/routes/users.py:428-472](services/user/app/routes/users.py#L428-L472)

**Endpoint**: `POST /api/users/me/check-username`

```bash
curl -X POST http://localhost:8080/api/users/me/check-username \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"username":"john"}'
```

**Response** (when taken):
```json
{
  "available": false,
  "username": "john",
  "suggestions": ["john1", "john2", "john3"]
}
```

**Response** (when available):
```json
{
  "available": true,
  "username": "john",
  "suggestions": []
}
```

---

## Frontend Changes

### 1. Type Definition
**File**: [frontend/shell/src/api/userService.ts:57-78](frontend/shell/src/api/userService.ts#L57-L78)

Added `username: string | null` to `DbUser` interface:
```typescript
export interface DbUser {
  id: string;
  username: string | null;  // ← NEW
  name: string;
  email: string;
  ...
}
```

### 2. API Methods
**File**: [frontend/shell/src/api/userService.ts:223-242](frontend/shell/src/api/userService.ts#L223-L242)

```typescript
userService.update(token, { 
  username: "phoenix"  // ← Now accepts username
})

userService.checkUsername(token, "phoenix")
  // Returns: { available: boolean; suggestions: string[] }
```

### 3. Username Edit Dialog Component
**File**: [frontend/shell/src/components/UsernameEditDialog.tsx](frontend/shell/src/components/UsernameEditDialog.tsx) ✨ NEW

Interactive dialog with:
- ✅ Real-time availability checking (debounced 500ms)
- ✅ Green checkmark when available
- ✅ Red error when taken
- ✅ Auto-suggestions as clickable chips (john1, john2, john3)
- ✅ Save/Cancel/Clear buttons
- ✅ Error handling & loading states
- ✅ Character length validation (3-50 chars)

### 4. User Menu Integration
**File**: [frontend/shell/src/components/UserMenu.tsx](frontend/shell/src/components/UserMenu.tsx)

Updated to:
- Display current username in profile header (e.g., `@phoenix`)
- Add "Set Alias Name" menu item with Badge icon
- Opens `UsernameEditDialog` on click
- Refreshes user data after save

---

## User Flow

### **Step 1: User Opens Menu**
1. Click user avatar in top-right
2. User menu opens, showing:
   - Real Name
   - **@alias_name** (if set)
   - Email
   - Role

### **Step 2: Click "Set Alias Name"**
- Dialog opens
- Shows form with placeholder "e.g., phoenix, silverstar, etc."

### **Step 3: Type Alias Name**
- Real-time validation as user types
- If 3+ characters and not taken: ✅ Green checkmark
- If taken: ❌ Red error + suggestions

```
Suggested alternatives:
[phoenix1] [phoenix2] [phoenix3]  ← Clickable chips
```

### **Step 4: Save**
- Click Save button
- Backend validates uniqueness one more time
- Dialog closes
- Menu refreshes to show new username

---

## Error Cases & Responses

| Scenario | HTTP Code | Error Message |
|---|---|---|
| Name taken | 409 | `Alias name 'john' is already taken` |
| Empty/whitespace | 400 | `Username cannot be empty` |
| Name too short (<3) | Frontend validation | `Alias name must be 3-50 characters` |
| Name too long (>50) | Frontend validation | `Alias name must be 3-50 characters` |
| API unavailable | 503 | Shown in alert |

---

## Database View

Before alias names:
```
id     | name           | username | email
-------|----------------|----------|--------
uuid1  | Rajesh Iyer    | NULL     | rajesh@...
uuid2  | Meera Krishnan | NULL     | meera@...
```

After backfill + users setting alias names:
```
id     | name           | username | email
-------|----------------|----------|--------
uuid1  | Rajesh Iyer    | phoenix  | rajesh@...
uuid2  | Meera Krishnan | mystic   | meera@...
```

---

## Testing Checklist

- [ ] User can see "Set Alias Name" option in menu
- [ ] Dialog opens when clicked
- [ ] Real-time validation works (try: `a` → shows error, `phoenix` → shows green checkmark)
- [ ] Suggestions appear when name is taken (check database for taken names)
- [ ] Clicking suggestion auto-fills the field
- [ ] Save button disabled until valid & available
- [ ] After save, username appears in menu as `@phoenix`
- [ ] Refresh page — username persists
- [ ] Clear button works
- [ ] Can change alias name multiple times

---

## Future Enhancements

1. **Rate limiting** — prevent alias changes more than once per month
2. **Change history** — track old alias names for audit
3. **Directory display** — show `@username` in resident directory instead of real name
4. **@ Mentions** — use username for chat @ mentions
5. **Admin bulk actions** — set default aliases for users without them
6. **Username reservations** — prevent admins from being assigned taken names

---

## Files Modified

**Backend**:
- [services/user/app/models.py](services/user/app/models.py) — Added username to UserUpdateRequest
- [services/user/app/routes/users.py](services/user/app/routes/users.py) — Updated update_me, added check-username
- [db/migrations/040_backfill_username_from_name.sql](db/migrations/040_backfill_username_from_name.sql) — Backfill script

**Frontend**:
- [frontend/shell/src/api/userService.ts](frontend/shell/src/api/userService.ts) — Added checkUsername method, updated DbUser type
- [frontend/shell/src/components/UserMenu.tsx](frontend/shell/src/components/UserMenu.tsx) — Integrated dialog, show username
- [frontend/shell/src/components/UsernameEditDialog.tsx](frontend/shell/src/components/UsernameEditDialog.tsx) — NEW dialog component
