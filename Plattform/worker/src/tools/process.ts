import { execFile } from "node:child_process";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export function execFileWithTimeout(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.destroy();
  });
}
