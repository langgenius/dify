fn main() {
    std::process::exit(dify_agent_runtime::run_runner(
        &std::env::args().skip(1).collect::<Vec<_>>(),
    ));
}
