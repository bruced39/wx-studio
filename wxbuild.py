"""Bundle the studio (HTML + JS modules) into one self-contained HTML string."""
import re
from pathlib import Path

STUDIO = Path(__file__).parent / "studio"


def _version() -> str:
    root = Path(__file__).parent
    v = (root / "VERSION").read_text().strip() if (root / "VERSION").exists() else "dev"
    try:
        import subprocess

        h = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True, timeout=5).stdout.strip()
        if h:
            v += " · " + h
    except Exception:
        pass
    return v


def build_html() -> str:
    html = (STUDIO / "index.html").read_text(encoding="utf-8").replace("__WX_VERSION__", _version())

    def inline(m):
        js = (STUDIO / m.group(1)).read_text(encoding="utf-8").replace("</script", "<\\/script")
        return "<script>\n" + js + "\n</script>"

    return re.sub(r'<script src="([\w.\-]+\.js)"></script>', inline, html)


if __name__ == "__main__":
    out = Path(__file__).parent / "dist"
    out.mkdir(exist_ok=True)
    (out / "studio.html").write_text(build_html(), encoding="utf-8")
    print("wrote", out / "studio.html")
