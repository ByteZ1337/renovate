def main [] {
    let file = $env.FILE_PWD | path join .host
    if not ($file | path exists) {
        error make {msg: $"missing relay hostname file ($file)"}
    }
    let host = open --raw $file | str trim
    cd $env.FILE_PWD
    wrangler deploy --route $"($host)/*"
}
