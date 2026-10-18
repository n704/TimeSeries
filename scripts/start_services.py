from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def read_env(path: Path) -> dict[str, str]:
  values: dict[str, str] = {}
  if not path.is_file():
    return values
  for raw_line in path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    values[key.strip()] = value.strip().strip("\"'")
  return values


def validate() -> list[str]:
  errors: list[str] = []
  for command in ("uv", "npm"):
    if shutil.which(command) is None:
      errors.append(f"Required command is unavailable: {command}")

  local_env = read_env(ROOT / ".env")
  checkpoint_value = (
      os.environ.get("TIMESFM_CHECKPOINT_PATH")
      or local_env.get("TIMESFM_CHECKPOINT_PATH")
  )
  if not checkpoint_value:
    errors.append(
        "TIMESFM_CHECKPOINT_PATH is missing. Copy .env.example to .env and "
        "configure the local TimesFM checkpoint."
    )
  else:
    checkpoint = Path(checkpoint_value).expanduser()
    if not checkpoint.is_dir() or not any(checkpoint.iterdir()):
      errors.append(f"TimesFM checkpoint is missing or empty: {checkpoint}")
  return errors


def process_options() -> dict[str, object]:
  if os.name == "nt":
    return {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP}
  return {"start_new_session": True}


def stop_process(process: subprocess.Popen[bytes]) -> None:
  if process.poll() is not None:
    return
  if os.name == "nt":
    process.terminate()
  else:
    os.killpg(process.pid, signal.SIGTERM)
  try:
    process.wait(timeout=10)
  except subprocess.TimeoutExpired:
    if os.name == "nt":
      process.kill()
    else:
      os.killpg(process.pid, signal.SIGKILL)
    process.wait()


def start_services() -> int:
  commands = [
      (
          "backend",
          [
              "uv",
              "run",
              "uvicorn",
              "app.main:app",
              "--reload",
              "--host",
              "127.0.0.1",
              "--port",
              "8000",
          ],
          BACKEND,
      ),
      (
          "frontend",
          [
              "npm",
              "run",
              "dev",
              "--",
              "--host",
              "127.0.0.1",
              "--port",
              "5173",
          ],
          FRONTEND,
      ),
  ]
  processes: list[tuple[str, subprocess.Popen[bytes]]] = []
  stopping = False
  exit_code = 0

  def request_stop(signum: int, _frame: object) -> None:
    nonlocal stopping
    if not stopping:
      print(f"\nReceived signal {signum}; stopping services...", flush=True)
    stopping = True

  signal.signal(signal.SIGINT, request_stop)
  signal.signal(signal.SIGTERM, request_stop)

  try:
    for name, command, cwd in commands:
      print(f"Starting {name}: {' '.join(command)}", flush=True)
      process = subprocess.Popen(command, cwd=cwd, **process_options())
      processes.append((name, process))

    while not stopping:
      for name, process in processes:
        return_code = process.poll()
        if return_code is not None:
          print(f"{name} exited with status {return_code}; stopping services.")
          exit_code = return_code
          stopping = True
          break
      time.sleep(0.5)
  finally:
    for _, process in reversed(processes):
      stop_process(process)

  return exit_code


def main() -> int:
  parser = argparse.ArgumentParser(
      description="Start the TimeSeries backend and frontend development services."
  )
  parser.add_argument(
      "--check",
      action="store_true",
      help="Validate commands and TimesFM configuration without starting services.",
  )
  args = parser.parse_args()

  errors = validate()
  if errors:
    for error in errors:
      print(f"ERROR: {error}", file=sys.stderr)
    return 1
  if args.check:
    print("Startup prerequisites and TimesFM checkpoint are valid.")
    return 0
  return start_services()


if __name__ == "__main__":
  raise SystemExit(main())
