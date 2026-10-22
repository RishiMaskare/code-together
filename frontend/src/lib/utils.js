// This helper function capitalizes the first letter of a string
export const capitialize = (str) => {
  if (typeof str !== "string" || str.length === 0) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Turn a Judge0 execution result (from /api/collab/execute) into a clear,
// human-readable output string. It prioritises real failure signals:
//   - compile errors
//   - abnormal program status (Runtime Error / SIGSEGV / Time Limit Exceeded / etc.)
//   - captured stderr / stdout
export const formatExecutionResult = (data) => {
  const stdout = (data.stdout || "").replace(/\n+$/, "");
  const stderr = (data.stderr || "").replace(/\n+$/, "");
  const status = data.status || "";
  const isAccepted = status === "" || /accepted/i.test(status);

  // 1) Compilation failed (C++/Java/Go/etc.)
  if (data.compile_stderr) {
    return `⚠️ Compile Error:\n${data.compile_stderr}`;
  }

  // 2) Execution never completed normally -> show the status as the headline,
  //    e.g. "Runtime Error (NZEC)" for a segfault, or "Time Limit Exceeded"
  //    even when there is no stderr to show.
  if (!isAccepted) {
    const detail = stderr || stdout || (data.message || "").trim();
    return detail ? `❌ ${status}\n${detail}` : `❌ ${status}`;
  }

  // 3) Accepted run: print stdout (and stderr, if any).
  if (stdout && stderr) return `${stdout}\n\n⚠️ stderr:\n${stderr}`;
  if (stdout) return stdout;
  if (stderr) return `⚠️ stderr:\n${stderr}`;

  return "✅ Finished with no output.";
};
