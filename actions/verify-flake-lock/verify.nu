# Checks a flake.lock against the refs its inputs follow. Prevents fetching a forks commit through the parent repos url
# With --min-age, a rev also has to be at least that old.

const CHANNEL = '^https://channels\.nixos\.org/(?<channel>(nixos|nixpkgs)-[a-z0-9.\-]+)/nixexprs\.tar\.(xz|zst)$'
const RELEASE = '^https://releases\.nixos\.org/(nixos|nixpkgs)/[a-z0-9.\-]+/[a-z]+-[0-9a-z.\-]+\.(?<short>[0-9a-f]{12})/nixexprs\.tar\.(xz|zst)$'

# Whether rev is on ref in repo and old enough. ref null means the default branch
def check-rev [name: string, repo: string, ref: any, rev: string, min_age: duration]: nothing -> record {
    let ref = $ref | default (gh api $"repos/($repo)" --jq .default_branch)
    let compare = gh api $"repos/($repo)/compare/($rev)...($ref)?per_page=1" --jq .status | complete
    if $compare.exit_code != 0 {
        return {input: $name, ok: false, detail: $"($rev) is unknown to ($repo)"}
    }
    # base...head is "ahead" when the ref contains the rev and moved past it
    let status = $compare.stdout | str trim
    if $status not-in [ahead identical] {
        return {input: $name, ok: false, detail: $"($rev) is not on ($repo) ($ref) \(($status)\)"}
    }

    let date = gh api $"repos/($repo)/commits/($rev)" --jq .commit.committer.date | into datetime
    let age = (date now) - $date
    if $age < $min_age {
        return {input: $name, ok: false, detail: $"($rev) is only ($age | format duration hr) old, needs ($min_age)"}
    }
    {input: $name, ok: true, detail: $"($rev | str substring 0..11) on ($repo) ($ref), ($age | format duration day) old"}
}

def check-github [name: string, original: record, locked: record, min_age: duration]: nothing -> record {
    let declared = $"($original.owner)/($original.repo)" | str lowercase
    let actual = $"($locked.owner)/($locked.repo)" | str lowercase
    if $declared != $actual {
        return {input: $name, ok: false, detail: $"locked ($actual) but follows ($declared)"}
    }
    if ($original.rev? | is-not-empty) and $original.rev != $locked.rev {
        return {input: $name, ok: false, detail: $"pinned to ($original.rev) but locked ($locked.rev)"}
    }
    check-rev $name $declared ($original.rev? | default $original.ref?) $locked.rev $min_age
}

def check-channel [name: string, original: record, locked: record, min_age: duration]: nothing -> record {
    let channel = $original.url | parse --regex $CHANNEL
    let release = $locked.url | parse --regex $RELEASE
    if ($channel | is-empty) or ($release | is-empty) {
        return {input: $name, ok: false, detail: $"tarball ($locked.url) is not a NixOS channel release"}
    }
    if not ($locked.rev starts-with $release.0.short) {
        return {input: $name, ok: false, detail: $"($locked.url) does not belong to rev ($locked.rev)"}
    }
    # every channel has a nixpkgs branch of the same name that it is built from
    check-rev $name nixos/nixpkgs $channel.0.channel $locked.rev $min_age
}

def main [lockfile: path = "flake.lock", --min-age: duration = 0sec] {
    let lock = open --raw $lockfile | from json
    let results = $lock.nodes | transpose name node | where name != $lock.root | each {|input|
        let original = $input.node.original?
        let locked = $input.node.locked?
        match [$original.type?, $locked.type?] {
            [github github] => (check-github $input.name $original $locked $min_age)
            [tarball tarball] => (check-channel $input.name $original $locked $min_age)
            # follows = "..." inputs have no lock of their own
            [_, null] => null
            _ => {input: $input.name, ok: false, detail: $"($original.type?) -> ($locked.type?) inputs can't be verified"}
        }
    } | compact

    print ($results | table --index false)
    let failed = $results | where not ok
    if ($failed | is-not-empty) {
        error make {msg: $"($failed | length) of ($results | length) inputs failed verification"}
    }
}
