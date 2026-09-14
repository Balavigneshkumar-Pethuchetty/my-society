"""JWT/JWKS validation lives in services/shared/auth_core.py (see
MAINTAINABILITY_PLAN.md step 5) — this service had no local extra behavior."""
from shared.auth_core import (  # noqa: F401
    get_current_claims,
    get_optional_claims,
    require_role,
    require_internal_key,
)
