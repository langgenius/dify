fn main() {
    let a: Vec<String> = std::env::args().skip(1).collect();
    let mut ready = None;
    let mut i = 0;
    while i < a.len() {
        if a[i] == "--ready-file" {
            i += 1;
            ready = a.get(i).map(std::path::PathBuf::from);
        }
        i += 1;
    }
    if let Err(e) = dify_agent_runtime::run_sanitizer(ready.as_deref()) {
        eprintln!("sanitize-pty: {e}");
        std::process::exit(1)
    }
}
