// Repo configs can't override anything set here that is globalOnly.
module.exports = {
    platform: 'github',
    autodiscover: true,
    autodiscoverFilter: ['ByteZ1337/*'],
    onboarding: false,
    requireConfig: 'required',
    // for signed commits
    platformCommit: 'enabled',
    // no runtime tool downloads
    binarySource: 'global',
    // flake input relock from default.json, plus GPG-verified repo scripts via run-signed
    allowedCommands: [
        "^nix --extra-experimental-features 'nix-command flakes' flake lock --override-input [A-Za-z0-9-]+ github:[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/[0-9a-f]{40}$",
        "^run-signed \\.renovate/[A-Za-z0-9._-]+\\.sh( [A-Za-z0-9._-]+)*$",
    ],
    allowedUnsafeExecutions: [],
    // the flake input datasource asks api.github.com directly, so give it the app token instead of the shared
    // unauthenticated limit of the runner's IP
    hostRules: process.env.RENOVATE_TOKEN ? [{ matchHost: 'api.github.com', token: process.env.RENOVATE_TOKEN }] : [],
    repositoryCache: 'enabled',
    cacheDir: '/cache',
    dockerMaxPages: 10,
};
