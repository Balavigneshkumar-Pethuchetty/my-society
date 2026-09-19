# Alias Name Feature — User & System Flow

## User Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     USER SETS ALIAS NAME                           │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────┐
│  Click Avatar    │
│  in Top-Right    │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────┐
│  User Menu Opens                 │
│                                  │
│  👤 Rajesh Iyer                 │
│     rajesh@example.com          │
│     [resident role chip]         │
│                                  │
│  ✓ My Profile                   │
│  ✓ Set Alias Name    ◄──────────┼─── NEW OPTION
│  ✓ Settings                     │
│  ...                            │
└────────┬─────────────────────────┘
         │
         ▼
┌────────────────────────────────────┐
│  UsernameEditDialog Opens          │
│                                    │
│  Set Your Alias Name              │
│  ┌──────────────────────────────┐ │
│  │ Alias Name                   │ │
│  │ [         phoenix           ] │ │
│  │ e.g., phoenix, silverstar   │ │
│  └──────────────────────────────┘ │
│                                    │
│  Checking availability...          │
└────────┬───────────────────────────┘
         │
         ├─────────────────────────┬──────────────────────┐
         │                         │                      │
         ▼                         ▼                      ▼
    ✅ AVAILABLE          ❌ TAKEN            ⚠️ INVALID (too short)
   (GREEN checkmark)    (RED error)         (Disabled save button)
                     
    "phoenix" is          "john" is already      Suggestions:
    available!            taken                  ┌─────────────┐
                                                 │ john1       │
    [Save] button         Suggested             │ john2       │
    is ENABLED            alternatives:         │ john3       │
                          ┌─────────────┐       └─────────────┘
                          │ john1       │
                          │ john2       │     (Click any to auto-fill)
                          │ john3       │
                          └─────────────┘
         │                         │                      │
         └──────────┬──────────────┴──────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  User Clicks Save    │
         └──────────┬───────────┘
                    │
                    ▼
         ┌──────────────────────────────────────┐
         │ PUT /api/users/me                    │
         │ { "username": "phoenix" }            │
         │                                      │
         │ Backend:                             │
         │ 1. Check uniqueness (again)          │
         │ 2. Update users.username = phoenix   │
         │ 3. Return updated DbUser             │
         └──────────┬───────────────────────────┘
                    │
                    ├─ If conflict (409)
                    │  ↓
                    │  Dialog shows error:
                    │  "Alias name taken"
                    │  (User can retry)
                    │
                    └─ If success (200)
                       ↓
         ┌──────────────────────────────────────┐
         │ Dialog Closes                        │
         │ User Menu Refreshes                  │
         │                                      │
         │ Now Shows:                           │
         │ 👤 Rajesh Iyer                      │
         │    @phoenix  ◄─── NEW USERNAME      │
         │    rajesh@...                       │
         │    [resident role chip]              │
         └──────────────────────────────────────┘
```

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (React/MUI)                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ UserMenu.tsx                                         │ │
│  │ • Displays current username (@phoenix)              │ │
│  │ • Button: "Set Alias Name"                          │ │
│  │ • Opens UsernameEditDialog                          │ │
│  └────────────────┬─────────────────────────────────────┘ │
│                   │                                        │
│  ┌────────────────▼─────────────────────────────────────┐ │
│  │ UsernameEditDialog.tsx                               │ │
│  │ • Text input for alias name                         │ │
│  │ • Real-time validation (debounced 500ms)            │ │
│  │ • Shows availability status (✅/❌)                 │ │
│  │ • Displays suggestions (clickable chips)            │ │
│  │ • Save/Cancel/Clear buttons                         │ │
│  └────────────────┬─────────────────────────────────────┘ │
│                   │                                        │
│  ┌────────────────▼─────────────────────────────────────┐ │
│  │ userService (API Client)                             │ │
│  │ • update({ username: "..." })                       │ │
│  │ • checkUsername(username)                           │ │
│  └────────────────┬─────────────────────────────────────┘ │
│                   │ HTTP Requests                          │
└───────────────────┼──────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
  POST /me/check-username   PUT /me
  (Validation only)         (Save username)
        │                       │
┌───────┴───────────────────────┴──────────────────────────┐
│             BACKEND (FastAPI / Python)                   │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ POST /api/users/me/check-username                 │  │
│  │ • Extract { username } from request               │  │
│  │ • Query: SELECT * FROM users WHERE username = $1  │  │
│  │ • If taken:                                        │  │
│  │   - Generate suggestions (append 1-10)            │  │
│  │   - Return { available: false, suggestions: [...] }│  │
│  │ • If available:                                    │  │
│  │   - Return { available: true, suggestions: [] }   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌────────────────────────────────────────────────────┐  │
│  │ PUT /api/users/me (Update Endpoint)                │  │
│  │ • Extract { username } from request                │  │
│  │ • Query: SELECT * FROM users                       │  │
│  │   WHERE username = $1 AND keycloak_sub != $2      │  │
│  │ • If taken:                                        │  │
│  │   - Raise HTTPException(409, "Already taken")     │  │
│  │ • If available:                                    │  │
│  │   - UPDATE users SET username = $1                │  │
│  │   - Return updated DbUser (with new username)     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
└──────────────┬─────────────────────────────────────────────┘
               │ Database Queries
               ▼
┌────────────────────────────────────────────────────────────┐
│           DATABASE (PostgreSQL)                            │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  users TABLE (user_svc schema)                            │
│  ┌─────────────────────────────────────────────────────┐ │
│  │ id (UUID)       | PRIMARY KEY                       │ │
│  │ username (TEXT) | UNIQUE ◄─── Constraint enforces  │ │
│  │ name (VARCHAR)  |       uniqueness at DB level      │ │
│  │ email (TEXT)    |                                   │ │
│  │ phone (TEXT)    |                                   │ │
│  │ ...             |                                   │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                            │
│  Example rows:                                            │
│  ┌─────────────┬──────────────┬──────────────────────┐   │
│  │ id          │ username     │ name                 │   │
│  ├─────────────┼──────────────┼──────────────────────┤   │
│  │ uuid-1      │ phoenix      │ Rajesh Iyer          │   │
│  │ uuid-2      │ mystic       │ Meera Krishnan       │   │
│  │ uuid-3      │ NULL         │ Arjun Sharma         │   │
│  │ uuid-4      │ phoenix1     │ Another User         │   │
│  └─────────────┴──────────────┴──────────────────────┘   │
│                                                            │
│  UNIQUE Constraint on username column:                    │
│  ✓ Multiple NULLs allowed (users without alias names)   │
│  ✓ Each non-NULL value must be unique                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Validation Flow (Critical Path)

```
User Types "john" in Dialog
         │
         ▼
Frontend: 500ms Debounce
         │
         ▼
checkUsername(token, "john")
    │
    ├─ Call: POST /api/users/me/check-username
    │
    └─ Receive response:
       {
         available: false,
         username: "john",
         suggestions: ["john1", "john2", "john3"]
       }
    │
    ├─ Update UI:
    │  • Show RED error icon
    │  • Display: "john" is already taken
    │  • Show suggestion chips
    │  • Disable SAVE button
    │
    └─ User clicks suggestion "john1"
       (Auto-fills field)
       │
       ▼
    Trigger validation again (debounced)
       │
       ├─ Call: checkUsername(token, "john1")
       │
       └─ Response:
          {
            available: true,
            username: "john1",
            suggestions: []
          }
       │
       ├─ Update UI:
       │  • Show GREEN checkmark
       │  • Display: "john1" is available!
       │  • Clear suggestions
       │  • ENABLE SAVE button
       │
       └─ User clicks SAVE
          │
          ├─ Call: PUT /api/users/me
          │         { "username": "john1" }
          │
          ├─ Backend double-checks:
          │  SELECT 1 FROM users 
          │  WHERE username = 'john1' 
          │        AND keycloak_sub != current_user
          │
          ├─ If available:
          │  │ UPDATE users SET username = 'john1'
          │  │ RETURN { username: "john1", ... }
          │  │
          │  ├─ Frontend closes dialog
          │  └─ Refreshes user data
          │     (Menu now shows @john1)
          │
          └─ If taken (race condition):
             │ Return 409 Conflict
             │ Error: "Alias name 'john1' is already taken"
             │
             └─ Dialog shows error
                (User can retry or pick different name)
```

---

## Database Constraint Enforcement

```
SCENARIO 1: Two users try to claim "phoenix" simultaneously

Timeline:
────────

T1: User A enters "phoenix"
    ├─ POST /check-username → "available: true"  ✅
    └─ PUT /users/me → INSERT starts...

T2: User B enters "phoenix"
    ├─ POST /check-username → "available: true"  ✅ (moment of insertion still in progress)
    └─ PUT /users/me → INSERT starts...

T3: User A's INSERT commits
    └─ username = "phoenix" ✓

T4: User B's INSERT attempts to commit
    └─ UNIQUE Constraint violation!
    └─ PostgreSQL raises error
    └─ Backend catches, returns 409
    └─ Frontend shows: "Alias name 'phoenix' is already taken"

RESULT: User B must retry with different name
────────────────────────────────────────────────


SCENARIO 2: User updates phone while setting username

PUT /api/users/me
{
  "username": "phoenix",
  "phone": "+91-9999-999999"
}

Backend Logic:
──────────────
1. Check username uniqueness ✓
2. Check phone uniqueness ✓  
3. START TRANSACTION
   - Encrypt phone
   - UPDATE users SET username='phoenix', phone=<encrypted>
4. COMMIT
   OR ROLLBACK if any constraint fails

Result: Atomic operation (either both fields update or neither)
```
