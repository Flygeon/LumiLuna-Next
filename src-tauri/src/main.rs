#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;

/// 将 panic 信息写入 <系统临时目录>/lumiluna_login_debug.log（与登录调试共享同一文件）。
/// 同步 command（如 novel_content / novel_detail）在主线程执行，一旦 panic 整个应用
/// 直接闪退，前端 JS 错误处理器无法捕获——必须在原生层留痕。
fn write_panic_log(info: &dyn std::fmt::Display) {
    let path = std::env::temp_dir().join("lumiluna_login_debug.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let _ = writeln!(f, "[{:.3}] [PANIC] {}", t, info);
        let bt = std::backtrace::Backtrace::force_capture();
        let _ = writeln!(f, "[{:.3}] [PANIC-BACKTRACE] {}", t, bt);
    }
}

fn main() {
    // 捕获 Rust panic：先写日志再走默认行为（stderr + abort），
    // 用于定位“点击书籍闪退”这类同步 command 主线程崩溃。
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        write_panic_log(info);
        default_hook(info);
    }));
    lumiluna_lib::run()
}
