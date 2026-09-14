"""JWT/JWKS validation lives in services/shared/auth_core.py (see
MAINTAINABILITY_PLAN.md step 5) — this service had no local extra behavior."""
from shared.auth_core import get_current_claims, require_internal_key, require_role  # noqa: F401
