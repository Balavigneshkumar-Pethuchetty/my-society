import Keycloak from 'keycloak-js';

// VITE_KEYCLOAK_URL lets each environment point at its own Keycloak — set via
// Docker build arg (see docker-compose.yml's frontend service, sourced from
// KEYCLOAK_PUBLIC_URL in the active .env.<ENV> file) for the containerized
// build, or a local .env file for `npm run dev`. Falls back to the shared
// public instance so prod (which sets no override) is unaffected.
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.gm-global-techies-town.club',
  realm: 'society-events',
  clientId: 'society-frontend',
});

export default keycloak;
