"""JWT/JWKS validation and the require_event_access/_has_event_access primitives live in
services/shared/auth_core.py (see MAINTAINABILITY_PLAN.md step 5) — unified with
event-service's identical implementation."""
from shared.auth_core import (  # noqa: F401
    get_current_claims,
    require_role,
    require_event_access,
    _has_event_access,
)
