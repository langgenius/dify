use dify_agent_runtime::{Config, serve};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let mut config = Config::default();
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) != Some("serve") {
        eprintln!("Usage: shellctl serve [--listen HOST:PORT] [--state-dir PATH] [--token TOKEN]");
        return;
    }
    let mut i = 2;
    while i < args.len() {
        match args[i].as_str() {
            "--listen" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    config.listen = v.clone();
                }
            }
            "--state-dir" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    config.state_dir = v.into();
                    config.runtime_dir = config.state_dir.join("runtime");
                }
            }
            "--token" => {
                i += 1;
                if let Some(v) = args.get(i) {
                    config.auth_token = v.clone();
                }
            }
            other => {
                eprintln!("unknown flag: {other}");
                std::process::exit(2);
            }
        }
        i += 1;
    }
    if let Err(e) = serve(config).await {
        eprintln!("shellctl: {e}");
        std::process::exit(1);
    }
}
