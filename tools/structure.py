import ast
import json
import sys

MODULE_NAME = "(módulo)"
SNIPPET_MAX = 80


def compact(text, limit=SNIPPET_MAX):
    single = " ".join(str(text or "").split())
    return single if len(single) <= limit else single[: limit - 1] + "…"


def unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return ""


def signature(node):
    return ast.dump(node, annotate_fields=True, include_attributes=False)


class Collector:
    def __init__(self):
        self.nodes = []
        self.module = None

    def add(self, **entry):
        entry["id"] = "n" + str(len(self.nodes))
        self.nodes.append(entry)
        return entry

    def module_owner(self):
        if self.module is None:
            self.module = self.add(kind="module", name=MODULE_NAME, qual=MODULE_NAME, owner=None, line=1, sig="")
        return self.module

    def qualify(self, owner, name):
        if owner and owner["kind"] != "module":
            return owner["qual"] + "." + name
        return name

    def params(self, node):
        names = []
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            note = ": " + unparse(arg.annotation) if arg.annotation is not None else ""
            names.append(arg.arg + note)
        if node.args.vararg:
            names.append("*" + node.args.vararg.arg)
        if node.args.kwarg:
            names.append("**" + node.args.kwarg.arg)
        return "(" + ", ".join(names) + ")"

    def branch(self, owner, kind, node, head, detail=""):
        self.add(
            kind="call" if kind == "call" else "branch",
            type=kind,
            name=compact(head),
            owner=owner["id"],
            line=getattr(node, "lineno", 0),
            sig=signature(node),
            detail=detail,
        )

    def call_name(self, stmt):
        value = None
        if isinstance(stmt, (ast.Expr, ast.Assign, ast.AnnAssign, ast.AugAssign)):
            value = stmt.value
        if isinstance(value, ast.Await):
            value = value.value
        if isinstance(value, ast.Call):
            func = value.func
            if isinstance(func, ast.Name):
                return func.id
            if isinstance(func, ast.Attribute):
                return func.attr
            return "call"
        return None

    def visit_block(self, statements, owner):
        for stmt in statements:
            self.visit(stmt, owner)

    def visit(self, stmt, owner):
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
            kind = "method" if owner and owner["kind"] == "class" else "function"
            fn = self.add(
                kind=kind,
                name=stmt.name,
                qual=self.qualify(owner, stmt.name),
                owner=owner["id"] if owner else None,
                line=stmt.lineno,
                sig=signature(stmt),
                detail=self.params(stmt),
            )
            self.visit_block(stmt.body, fn)
            return
        if isinstance(stmt, ast.ClassDef):
            cls = self.add(
                kind="class",
                name=stmt.name,
                qual=self.qualify(owner, stmt.name),
                owner=owner["id"] if owner else None,
                line=stmt.lineno,
                sig=signature(stmt),
                detail="",
            )
            self.visit_block(stmt.body, cls)
            return
        here = owner or self.module_owner()
        if here["kind"] == "class":
            return
        if isinstance(stmt, ast.If):
            self.branch(here, "if", stmt, "if " + unparse(stmt.test))
            self.visit_block(stmt.body, owner)
            self.visit_block(stmt.orelse, owner)
            return
        if isinstance(stmt, (ast.For, ast.AsyncFor)):
            prefix = "async for " if isinstance(stmt, ast.AsyncFor) else "for "
            self.branch(here, "for", stmt, prefix + unparse(stmt.target) + " in " + unparse(stmt.iter))
            self.visit_block(stmt.body, owner)
            self.visit_block(stmt.orelse, owner)
            return
        if isinstance(stmt, ast.While):
            self.branch(here, "while", stmt, "while " + unparse(stmt.test))
            self.visit_block(stmt.body, owner)
            self.visit_block(stmt.orelse, owner)
            return
        if isinstance(stmt, ast.Try) or type(stmt).__name__ == "TryStar":
            self.branch(here, "try", stmt, "try")
            self.visit_block(stmt.body, owner)
            for handler in stmt.handlers:
                label = "except " + unparse(handler.type) if handler.type is not None else "except"
                self.branch(here, "catch", handler, label)
                self.visit_block(handler.body, owner)
            self.visit_block(stmt.orelse, owner)
            self.visit_block(stmt.finalbody, owner)
            return
        if isinstance(stmt, (ast.With, ast.AsyncWith)):
            self.branch(here, "with", stmt, "with " + ", ".join(unparse(item) for item in stmt.items))
            self.visit_block(stmt.body, owner)
            return
        if type(stmt).__name__ == "Match":
            self.branch(here, "switch", stmt, "match " + unparse(stmt.subject))
            for case in stmt.cases:
                self.visit_block(case.body, owner)
            return
        if isinstance(stmt, ast.Return):
            self.branch(here, "return", stmt, unparse(stmt) or "return")
            return
        if isinstance(stmt, ast.Raise):
            self.branch(here, "throw", stmt, unparse(stmt) or "raise")
            return
        callee = self.call_name(stmt)
        if callee:
            self.branch(here, "call", stmt, unparse(stmt), callee)


def main():
    source = sys.stdin.read()
    try:
        tree = ast.parse(source)
    except SyntaxError as err:
        print(json.dumps({"error": "syntax", "line": err.lineno or 0}))
        return
    collector = Collector()
    collector.visit_block(tree.body, None)
    print(json.dumps({"nodes": collector.nodes}, ensure_ascii=False))


if __name__ == "__main__":
    main()
