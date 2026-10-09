// Web Worker that runs the player's Python against a ticket's tests using Pyodide.
// It lives in a worker so an infinite loop can be killed from the game.
import { loadPyodide } from '../node_modules/pyodide/pyodide.mjs';

const HARNESS = `
import contextlib, io, json


def _describe(err):
    line = None
    if isinstance(err, SyntaxError):
        line = err.lineno
    else:
        tb = err.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_filename == "solution.py":
                line = tb.tb_lineno
            tb = tb.tb_next
    text = err.msg if isinstance(err, SyntaxError) else str(err)
    where = f" (solution.py, line {line})" if line else ""
    return f"{type(err).__name__}: {text}{where}"


def run_tests(code, fn, tests_json):
    out = io.StringIO()
    report = {"results": []}
    try:
        scope = {"__name__": "solution"}
        with contextlib.redirect_stdout(out):
            exec(compile(code, "solution.py", "exec"), scope)
        solution = scope.get(fn)
        if not callable(solution):
            raise NameError(f"expected a function named {fn}")
        for case in json.loads(tests_json):
            call = f"{fn}({', '.join(repr(a) for a in case['args'])})"
            result = {"call": call, "expected": repr(case["expect"])}
            try:
                with contextlib.redirect_stdout(out):
                    got = solution(*json.loads(json.dumps(case["args"])))
                result["ok"] = type(got) is type(case["expect"]) and got == case["expect"]
                result["got"] = repr(got)
            except Exception as err:
                result["ok"] = False
                result["got"] = _describe(err)
            report["results"].append(result)
    except BaseException as err:
        report = {"error": _describe(err)}
    report["logs"] = out.getvalue().splitlines()[:60]
    return json.dumps(report)
`;

const ready = loadPyodide({ indexURL: new URL('../node_modules/pyodide/', self.location).href }).then((py) => {
  py.runPython(HARNESS);
  return py.globals.get('run_tests');
});
ready.then(() => postMessage({ ready: true }), (err) => postMessage({ fatal: String(err) }));

onmessage = async ({ data: { id, code, fn, tests } }) => {
  try {
    const runTests = await ready;
    postMessage({ id, ...JSON.parse(runTests(code, fn, JSON.stringify(tests))) });
  } catch (err) {
    postMessage({ id, error: String(err), logs: [] });
  }
};
