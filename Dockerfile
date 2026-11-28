# Renovate with all the tools it calls included in the image so nothing is downloaded at runtime.
# install-tool checks each download against the checksum in the image's own tool-versions data
# for integrity.

FROM renovate/renovate:44.239.1@sha256:7dba1a3b916a2cf302ba0df458ddcc8fcbac3c92d0fe9882ac13ba0363de656b

# renovate: datasource=github-releases depName=cli/cli extractVersion=^v(?<version>.+)$
ARG GH_VERSION=2.104.0
# renovate: datasource=github-releases depName=jdx/mise extractVersion=^v(?<version>.+)$
ARG MISE_VERSION=2026.11.7
# renovate: datasource=github-releases depName=containerbase/nix-prebuild
ARG NIX_VERSION=2.35.6
# renovate: datasource=rust-version depName=rust
ARG RUST_VERSION=1.100.0
# renovate: datasource=github-releases depName=github/gh-actions-lock
ARG GH_ACTIONS_LOCK_VERSION=v0.4.1

USER root
RUN for tool in "gh $GH_VERSION" "mise $MISE_VERSION" "nix $NIX_VERSION" "rust $RUST_VERSION"; do \
        set -- $tool; \
        if [ ! -f "/usr/local/containerbase/tool-versions/v1/$1/$2.json" ]; then \
            echo "no pinned hash for $1 $2 in base image. Bump base image?" >&2; exit 1; \
        fi; \
        install-tool "$1" "$2"; \
    done

RUN mkdir -m 0755 -p /etc/renovate/keys
COPY --chmod=0755 scripts/run-signed /usr/local/bin/run-signed
COPY --chmod=0644 keys/ /etc/renovate/keys/

USER 12021
WORKDIR /home/ubuntu/gh-actions-lock
RUN --mount=type=secret,id=gh,env=GH_TOKEN,uid=12021 \
    gh release download "$GH_ACTIONS_LOCK_VERSION" --repo github/gh-actions-lock --pattern linux-amd64 \
    && gh release verify-asset "$GH_ACTIONS_LOCK_VERSION" linux-amd64 --repo github/gh-actions-lock \
    && mv linux-amd64 gh-actions-lock && chmod +x gh-actions-lock \
    && gh extension install . \
    && gh actions-lock --version
WORKDIR /home/ubuntu
