FROM infisical/infisical@sha256:1b4f37a5e2e3de198b60a95d53e54cb94d67a2fda74e76c89e2812cd1e8326a6

USER root
COPY --chmod=644 guard.mjs /backend/dist/services/role/tastile-development-testing-guard.mjs
COPY patch.mjs /opt/tastile-development-testing-patch.mjs
RUN node /opt/tastile-development-testing-patch.mjs \
      /backend/dist/services/role/role-service.mjs \
      9d8565d9a0de67f3317e8b4dbb82210784fd3631b2f3ac5f1ab8dfea8fa30acf \
    && node --check /backend/dist/services/role/role-service.mjs \
    && node /opt/tastile-development-testing-patch.mjs \
      /backend/dist/services/membership-identity/membership-identity-service.mjs \
      042f86f211d61559673188fc588f996375771849181beb4b84e98ca72d23c505 membership \
    && node --check /backend/dist/services/membership-identity/membership-identity-service.mjs \
    && rm /opt/tastile-development-testing-patch.mjs
USER 1001
RUN node -e 'import("/backend/dist/services/role/tastile-development-testing-guard.mjs")'

LABEL org.tastile.purpose="development-testing" \
      org.tastile.decision="ADR-0022"
