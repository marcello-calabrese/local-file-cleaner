//! Recognises folders that only hold regenerable data (build output,
//! package caches, browser caches, temp folders).

use std::path::Path;

use crate::filters::normalize;

/// Folder names that are caches wherever they appear.
const NAME_RULES: &[(&str, &str)] = &[
    ("node_modules", "Node.js packages"),
    ("__pycache__", "Python bytecode"),
    (".pytest_cache", "Python test cache"),
    (".mypy_cache", "Python type-check cache"),
    (".ruff_cache", "Python lint cache"),
    (".gradle", "Gradle cache"),
    (".next", "Next.js build cache"),
    (".nuxt", "Nuxt build cache"),
    (".parcel-cache", "Parcel cache"),
    (".turbo", "Turborepo cache"),
    (".sass-cache", "Sass cache"),
    (".cache", "Tool cache"),
];

/// Names that are caches when they live under an AppData folder
/// (Chromium/Electron apps, Firefox, GPU shader caches).
const APPDATA_NAME_RULES: &[(&str, &str)] = &[
    ("cache", "Application cache"),
    ("code cache", "Application code cache"),
    ("gpucache", "GPU cache"),
    ("dawncache", "GPU cache"),
    ("shadercache", "Shader cache"),
    ("grshadercache", "Shader cache"),
    ("cache2", "Browser cache"),
    ("crashpad", "Crash reports"),
];

/// Known locations, relative to %LOCALAPPDATA% / %APPDATA% / %USERPROFILE%.
const LOCAL_APPDATA_RULES: &[(&str, &str)] = &[
    ("temp", "Temporary files"),
    (r"microsoft\windows\inetcache", "Internet cache"),
    ("d3dscache", "DirectX shader cache"),
    ("crashdumps", "Crash dumps"),
    ("npm-cache", "npm cache"),
    (r"pip\cache", "pip cache"),
    (r"yarn\cache", "Yarn cache"),
    (r"nuget\v3-cache", "NuGet cache"),
    (r"microsoft\windows\webcache", "Windows web cache"),
];
const ROAMING_APPDATA_RULES: &[(&str, &str)] = &[("npm-cache", "npm cache")];
const USER_PROFILE_RULES: &[(&str, &str)] = &[
    (r".cargo\registry\cache", "Cargo download cache"),
    (r".nuget\packages", "NuGet packages"),
    (r".gradle\caches", "Gradle cache"),
];

#[derive(Debug, Default)]
pub struct CacheRules {
    known: Vec<(String, &'static str)>,
}

impl CacheRules {
    /// Builds rules using the current user's environment.
    pub fn from_env() -> Self {
        let mut known = Vec::new();
        let mut add = |var: &str, rules: &[(&str, &'static str)]| {
            if let Some(base) = std::env::var_os(var) {
                let base = normalize(Path::new(&base));
                for (rel, kind) in rules {
                    known.push((format!("{base}\\{rel}"), *kind));
                }
            }
        };
        add("LOCALAPPDATA", LOCAL_APPDATA_RULES);
        add("APPDATA", ROAMING_APPDATA_RULES);
        add("USERPROFILE", USER_PROFILE_RULES);
        if let Some(tmp) = std::env::var_os("TEMP") {
            known.push((normalize(Path::new(&tmp)), "Temporary files"));
        }
        // Longest first so the most specific rule wins.
        known.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
        Self { known }
    }

    /// Returns the cache kind if `dir` is a cache folder.
    pub fn classify(&self, dir: &Path) -> Option<&'static str> {
        let name = dir.file_name()?.to_string_lossy().to_lowercase();
        if let Some((_, kind)) = NAME_RULES.iter().find(|(n, _)| *n == name) {
            return Some(kind);
        }
        if name == "target" && dir.with_file_name("Cargo.toml").is_file() {
            return Some("Rust build output");
        }
        let norm = normalize(dir);
        if let Some((_, kind)) = self.known.iter().find(|(k, _)| *k == norm) {
            return Some(kind);
        }
        if norm.contains("\\appdata\\") {
            if let Some((_, kind)) = APPDATA_NAME_RULES.iter().find(|(n, _)| *n == name) {
                return Some(kind);
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_name_and_location() {
        let rules = CacheRules {
            known: vec![(r"c:\users\a\appdata\local\temp".into(), "Temporary files")],
        };
        assert_eq!(
            rules.classify(Path::new(r"C:\proj\node_modules")),
            Some("Node.js packages")
        );
        assert_eq!(
            rules.classify(Path::new(r"C:\Users\a\AppData\Local\Temp")),
            Some("Temporary files")
        );
        assert_eq!(
            rules.classify(Path::new(r"C:\Users\a\AppData\Roaming\Slack\Cache")),
            Some("Application cache")
        );
        assert_eq!(rules.classify(Path::new(r"C:\Users\a\Documents\Cache")), None);
        assert_eq!(rules.classify(Path::new(r"C:\proj\src")), None);
    }
}
