import re
import subprocess
import tempfile
import zipfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import rarfile
from rapidfuzz import fuzz, process

from app.importer.structured_parser import parse_archive

LEVELS = ["Beginner", "Elementary", "Pre-Intermediate", "Intermediate"]
IGNORED = {"thumbs.db", "__macosx"}


@dataclass
class ManifestEntry:
    path: str
    role: str
    level: str | None = None
    exam_type: str | None = None
    variant: int | None = None
    warnings: list[str] = field(default_factory=list)


class ImportPipeline:
    """Conservative archive parser: never discards ambiguous source content."""

    def __init__(self, source: Path, max_depth: int = 3, max_files: int = 2000):
        self.source = source
        self.max_depth = max_depth
        self.max_files = max_files
        self.warnings: list[str] = []

    def run(self) -> dict[str, Any]:
        with tempfile.TemporaryDirectory(prefix="examflow-import-") as tmp:
            root = Path(tmp)
            self._extract(self.source, root, 0)
            self._convert_legacy_docs(root)
            manifest = [self._classify(path, root) for path in self._retained_files(root)]
            parsed = parse_archive(root)
            return {
                "manifest": [asdict(item) for item in manifest],
                "warnings": self.warnings,
                "summary": {"files": len(manifest), **parsed["summary"]},
                "tests": parsed["tests"],
            }

    def _extract(self, archive: Path, target: Path, depth: int) -> None:
        if depth > self.max_depth:
            self.warnings.append(f"Nested archive depth exceeded: {archive.name}")
            return
        unpack = target / f"layer-{depth}-{archive.stem}"
        unpack.mkdir(parents=True, exist_ok=True)
        if archive.suffix.lower() == ".zip":
            with zipfile.ZipFile(archive) as bundle:
                for info in bundle.infolist():
                    resolved = (unpack / info.filename).resolve()
                    if unpack.resolve() not in resolved.parents and resolved != unpack.resolve():
                        self.warnings.append(f"Blocked unsafe path: {info.filename}")
                        continue
                    if info.file_size > 100 * 1024 * 1024:
                        self.warnings.append(f"Skipped oversized member: {info.filename}")
                        continue
                    bundle.extract(info, unpack)
        elif archive.suffix.lower() == ".rar":
            with rarfile.RarFile(archive) as bundle:
                bundle.extractall(unpack)
        for nested in [*unpack.rglob("*.zip"), *unpack.rglob("*.rar")]:
            self._extract(nested, nested.parent / "extracted", depth + 1)

    def _retained_files(self, root: Path) -> list[Path]:
        result = []
        for path in root.rglob("*"):
            lower = path.name.lower()
            if not path.is_file() or lower.startswith(("~$", ".")) or lower.endswith(".tmp"):
                continue
            if any(part.lower() in IGNORED for part in path.parts):
                continue
            result.append(path)
            if len(result) >= self.max_files:
                self.warnings.append("File count limit reached; remaining files were skipped.")
                break
        return result

    def _convert_legacy_docs(self, root: Path) -> list[Path]:
        converted: list[Path] = []
        for source in root.rglob("*.doc"):
            output = source.parent / "converted"
            output.mkdir(exist_ok=True)
            try:
                subprocess.run(
                    ["libreoffice", "--headless", "--convert-to", "docx", "--outdir", str(output), str(source)],
                    check=True, timeout=90, capture_output=True,
                )
                converted.append(output / f"{source.stem}.docx")
            except (subprocess.SubprocessError, FileNotFoundError) as exc:
                self.warnings.append(f"Could not convert {source.name}: {exc}")
        return [path for path in converted if path.exists()]

    def _classify(self, path: Path, root: Path) -> ManifestEntry:
        relative = str(path.relative_to(root))
        normalized = relative.replace("\\", "/")
        level_match = process.extractOne(normalized, LEVELS, scorer=fuzz.partial_ratio, score_cutoff=65)
        exam = "Mid-course Exam" if re.search(r"(^|/)mid(/|$)", normalized, re.I) else (
            "End-course Exam" if re.search(r"(^|/)end(/|$)", normalized, re.I) else None
        )
        variant_match = re.search(r"\bV(?:ariant)?\s*[-_ ]?(\d+)\b", path.stem, re.I)
        role = "audio" if "audio" in normalized.lower() or path.suffix.lower() in {".mp3", ".wav", ".m4a", ".ogg"} else (
            "answer_key" if re.search(r"answer|key", path.stem, re.I) else "question_document"
        )
        return ManifestEntry(
            path=relative, role=role,
            level=level_match[0] if level_match else None,
            exam_type=exam,
            variant=int(variant_match.group(1)) if variant_match else None,
        )

