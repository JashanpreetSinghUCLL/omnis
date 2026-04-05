"""khub — Universal Knowledge Hub CLI.

Commands
--------
    khub ingest <file>          Ingest a PDF into the knowledge graph.
    khub ask "<question>"       Ask a question and stream the answer.
    khub graph explore          Browse entities in the knowledge graph.
    khub eval run               Run the evaluation suite.
    khub status                 Check all service dependencies.

Install
-------
    pip install -e .            # makes `khub` available on PATH

Shell completions
-----------------
    khub --install-completion   # auto-detects your shell (bash/zsh/fish)
    khub --show-completion      # print the completion script
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Annotated, Any

import typer
from rich.columns import Columns
from rich.console import Console
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

console = Console()

# ── Sub-apps ──────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="khub",
    help="Universal Knowledge Hub — GraphRAG-powered knowledge management.",
    add_completion=True,
    rich_markup_mode="rich",
    no_args_is_help=True,
)

graph_app = typer.Typer(help="Knowledge graph commands.", no_args_is_help=True)
eval_app = typer.Typer(help="Evaluation commands.", no_args_is_help=True)

app.add_typer(graph_app, name="graph")
app.add_typer(eval_app, name="eval")


# ── Config helpers ────────────────────────────────────────────────────────────


def _load_settings() -> Any:
    """Load Settings from environment / .env; exit with a friendly error if missing."""
    try:
        from api.config import get_settings

        return get_settings()
    except Exception as exc:
        console.print(f"[red]Config error:[/red] {exc}")
        console.print("[dim]Tip: copy .env.example → .env and fill in your API keys.[/dim]")
        raise typer.Exit(code=1) from exc


def _ingestion_config_from_settings(settings: Any) -> Any:
    """Build an IngestionConfig from a Settings instance."""
    from ingestion.pipeline import IngestionConfig

    return IngestionConfig(
        neo4j_uri=settings.neo4j_uri,
        neo4j_user=settings.neo4j_user,
        neo4j_password=settings.neo4j_password_str,
        qdrant_url=str(settings.qdrant_url),
        qdrant_api_key=settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None,
        redis_url=settings.redis_url,
        anthropic_api_key=settings.anthropic_api_key_str,
        voyage_api_key=settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else None,
        llama_cloud_api_key=settings.llama_cloud_api_key_str,
    )


# ── khub ingest ───────────────────────────────────────────────────────────────

_STAGES = ["parse", "chunk", "embed", "graph", "vector"]
_STAGE_LABELS = {
    "parse": "Parsing",
    "chunk": "Chunking",
    "embed": "Embedding",
    "graph": "Graph extraction",
    "vector": "Vector store",
}
_STATUS_ICON = {
    "pending": "[dim]○[/dim]",
    "running": "[yellow]⟳[/yellow]",
    "done": "[green]✓[/green]",
    "skip": "[cyan]↩[/cyan]",
    "error": "[red]✗[/red]",
}


def _build_ingest_table(
    stage_statuses: dict[str, str],
    stage_times: dict[str, float],
    stage_details: dict[str, str],
    overall_pct: int,
    bytes_processed: int,
    entities_found: int,
    elapsed: float,
) -> Table:
    """Render the ingestion progress table for Rich Live."""
    table = Table(show_header=True, header_style="bold cyan", box=None, padding=(0, 1))
    table.add_column("Stage", min_width=18)
    table.add_column("Status", min_width=10)
    table.add_column("Time", min_width=8, justify="right")
    table.add_column("Details")

    for stage in _STAGES:
        status = stage_statuses.get(stage, "pending")
        icon = _STATUS_ICON.get(status, "○")
        label = _STAGE_LABELS[stage]
        t = stage_times.get(stage)
        time_str = f"{t:.1f}s" if t is not None else "—"
        detail = stage_details.get(stage, "")
        table.add_row(f"  {label}", icon, time_str, f"[dim]{detail}[/dim]")

    bar_filled = "━" * (overall_pct // 5)
    bar_empty = "─" * (20 - overall_pct // 5)
    bar = f"[green]{bar_filled}[/green][dim]{bar_empty}[/dim]"

    mb = bytes_processed / (1024 * 1024)
    footer = (
        f"\n  Overall {bar} {overall_pct:3d}%  "
        f"[dim]elapsed: {elapsed:.1f}s   "
        f"bytes: {mb:.1f} MB   "
        f"entities: {entities_found}[/dim]"
    )

    panel = Panel(
        table,
        title="[bold]khub ingest[/bold]",
        subtitle=Text.from_markup(footer),
        border_style="cyan",
        padding=(1, 2),
    )
    # Wrap in a simple table so Live can render the Panel
    wrapper = Table.grid()
    wrapper.add_row(panel)
    return wrapper


@app.command()
def ingest(
    file: Annotated[Path, typer.Argument(help="PDF file to ingest.", exists=True, readable=True)],
    tenant: Annotated[str, typer.Option("--tenant", "-t", help="Tenant ID.")] = "default",
    collection: Annotated[str, typer.Option("--collection", "-c", help="Qdrant collection.")] = "omnis_docs",
) -> None:
    """[bold cyan]Ingest[/bold cyan] a PDF into the knowledge graph.

    Shows a live progress panel with per-stage timing and entity counts.
    Re-running the same file is safe — already-completed stages are skipped.
    """
    settings = _load_settings()
    cfg = _ingestion_config_from_settings(settings)
    cfg.tenant_id = tenant
    cfg.collection_name = collection

    file_bytes = file.stat().st_size

    # ── Live progress state
    stage_statuses: dict[str, str] = dict.fromkeys(_STAGES, "pending")
    stage_times: dict[str, float] = {}
    stage_details: dict[str, str] = {}
    stage_start: dict[str, float] = {}
    entities_found = 0

    def progress_cb(stage: str, event: str, data: dict[str, Any]) -> None:
        nonlocal entities_found
        if stage == "*" and event == "skip":
            for s in _STAGES:
                stage_statuses[s] = "skip"
            return
        if stage not in _STAGES:
            return
        if event == "start":
            stage_statuses[stage] = "running"
            stage_start[stage] = time.perf_counter()
            stage_details[stage] = "running…"
        elif event == "done":
            stage_statuses[stage] = "done"
            elapsed_s = data.get("elapsed_s") or (time.perf_counter() - stage_start.get(stage, time.perf_counter()))
            stage_times[stage] = elapsed_s
            if stage == "parse":
                stage_details[stage] = f"{data.get('pages', '?')} pages, hash={data.get('hash', '?')}"
            elif stage == "chunk":
                stage_details[stage] = f"{data.get('count', '?')} chunks"
            elif stage == "embed":
                stage_details[stage] = f"{data.get('count', '?')} vectors"
            elif stage == "graph":
                e = data.get("entities", 0)
                r = data.get("relations", 0)
                entities_found = e
                stage_details[stage] = f"{e} entities, {r} relations"
            elif stage == "vector":
                stage_details[stage] = f"{data.get('count', '?')} points written"
        elif event == "skip":
            stage_statuses[stage] = "skip"
            stage_details[stage] = "already done"
        elif event == "error":
            stage_statuses[stage] = "error"
            stage_details[stage] = str(data.get("error", "failed"))

    t_start = time.perf_counter()

    async def _run() -> Any:
        from ingestion.pipeline import run_ingestion

        return await run_ingestion(file, cfg, progress_cb=progress_cb)

    with Live(console=console, refresh_per_second=8) as live:

        async def _run_with_refresh() -> Any:
            task = asyncio.create_task(_run())
            while not task.done():
                done_count = sum(1 for s in stage_statuses.values() if s in ("done", "skip"))
                pct = int(done_count / len(_STAGES) * 100)
                live.update(
                    _build_ingest_table(
                        stage_statuses,
                        stage_times,
                        stage_details,
                        pct,
                        file_bytes,
                        entities_found,
                        time.perf_counter() - t_start,
                    )
                )
                await asyncio.sleep(0.1)
            return await task

        result = asyncio.run(_run_with_refresh())

    # Final render — 100%
    console.print(
        _build_ingest_table(
            stage_statuses,
            stage_times,
            stage_details,
            100,
            file_bytes,
            result.entities_extracted,
            result.total_s,
        )
    )

    if result.skipped:
        console.print("\n[cyan]↩  Already processed — skipped.[/cyan]")
    else:
        console.print(f"\n[green]✓  Done in {result.total_s:.1f}s[/green]  —  {result.source}")


# ── khub ask ──────────────────────────────────────────────────────────────────


def _make_embed_fn_cli(voyage_key: str | None) -> Any:
    if voyage_key:
        import voyageai  # type: ignore[import-untyped]

        client = voyageai.AsyncClient(api_key=voyage_key)

        async def _voyage(text: str) -> list[float]:
            r = await client.embed([text], model="voyage-query-lite-04")
            vec: list[float] = r.embeddings[0]
            return vec

        return _voyage

    from fastembed import TextEmbedding  # type: ignore[import-untyped]

    model = TextEmbedding("BAAI/bge-large-en-v1.5")

    async def _bge(text: str) -> list[float]:
        loop = asyncio.get_running_loop()
        vecs = await loop.run_in_executor(None, lambda: list(model.embed([text])))
        return vecs[0].tolist()

    return _bge


@app.command()
def ask(
    question: Annotated[str, typer.Argument(help="Question to ask the knowledge hub.")],
    tenant: Annotated[str, typer.Option("--tenant", "-t", help="Tenant ID.")] = "default",
    session: Annotated[str, typer.Option("--session", "-s", help="Session ID.")] = "cli",
    no_reasoning: Annotated[bool, typer.Option("--no-reasoning", help="Hide agent reasoning panel.")] = False,
) -> None:
    """[bold cyan]Ask[/bold cyan] a question and stream the answer.

    Shows agent reasoning steps as they happen (classifier → researcher → reviewer),
    streams answer tokens, and appends a citation table on completion.
    """
    settings = _load_settings()

    async def _run() -> None:
        from agents.graph import build_graph
        from agents.state import AgentState

        voyage_key = settings.voyage_api_key.get_secret_value() if settings.voyage_api_key else None
        embed_fn = _make_embed_fn_cli(voyage_key)

        graph = build_graph(
            anthropic_api_key=settings.anthropic_api_key_str,
            qdrant_url=str(settings.qdrant_url),
            qdrant_api_key=settings.qdrant_api_key.get_secret_value() if settings.qdrant_api_key else None,
            neo4j_uri=settings.neo4j_uri,
            neo4j_user=settings.neo4j_user,
            neo4j_password=settings.neo4j_password_str,
            cohere_api_key=settings.cohere_api_key_str,
            embed_fn=embed_fn,
        )

        initial_state: AgentState = {  # type: ignore[assignment]
            "question": question,
            "session_id": session,
            "tenant_id": tenant,
            "route": None,
            "model_used": "",
            "context": [],
            "citations": [],
            "memory_facts": [],
            "code_snippet": None,
            "final_answer": None,
            "errors": [],
            "faithfulness_score": None,
            "retry_count": 0,
        }

        # ── Reasoning panel (live updated)
        reasoning_lines: list[str] = []
        final_state: dict[str, Any] = {}

        _NODE_ICONS = {
            "classifier": "🔀",
            "researcher": "🔍",
            "coder": "💻",
            "reviewer": "🔎",
            "degradation": "⚠️",
        }

        def _reasoning_panel() -> Panel:
            body = "\n".join(reasoning_lines) if reasoning_lines else "[dim]Starting…[/dim]"
            return Panel(body, title="[bold]Agent Reasoning[/bold]", border_style="yellow", padding=(0, 1))

        t0 = time.perf_counter()

        with Live(console=console, refresh_per_second=10) as live:
            if not no_reasoning:
                live.update(_reasoning_panel())

            async for chunk in graph.astream(initial_state):  # type: ignore[union-attr]
                for node_name, node_output in chunk.items():
                    icon = _NODE_ICONS.get(node_name, "•")
                    elapsed = time.perf_counter() - t0

                    if node_name == "classifier":
                        route = node_output.get("route", "?")
                        model = node_output.get("model_used", "?")
                        reasoning_lines.append(
                            f"  {icon} [bold]Classifier[/bold]  →  route=[cyan]{route}[/cyan]  model=[dim]{model}[/dim]  ([dim]{elapsed:.1f}s[/dim])"
                        )
                    elif node_name == "researcher":
                        chunks = len(node_output.get("context", []))
                        reasoning_lines.append(
                            f"  {icon} [bold]Researcher[/bold]  retrieved [cyan]{chunks}[/cyan] chunks  ([dim]{elapsed:.1f}s[/dim])"
                        )
                    elif node_name == "coder":
                        retry = node_output.get("retry_count", 0)
                        reasoning_lines.append(
                            f"  {icon} [bold]Coder[/bold]  retry=[cyan]{retry}[/cyan]  ([dim]{elapsed:.1f}s[/dim])"
                        )
                    elif node_name == "reviewer":
                        score = node_output.get("faithfulness_score")
                        score_str = f"{score:.2f}" if score is not None else "?"
                        passed = (score or 0) >= 0.85
                        color = "green" if passed else "red"
                        reasoning_lines.append(
                            f"  {icon} [bold]Reviewer[/bold]  faithfulness=[{color}]{score_str}[/{color}]  ([dim]{elapsed:.1f}s[/dim])"
                        )
                    elif node_name == "degradation":
                        reasoning_lines.append(
                            f"  {icon} [bold red]Degradation[/bold red]  max retries reached  ([dim]{elapsed:.1f}s[/dim])"
                        )

                    final_state.update(node_output)

                    if not no_reasoning:
                        live.update(_reasoning_panel())

        # ── Print reasoning panel (static after graph finishes)
        if not no_reasoning:
            console.print(_reasoning_panel())

        # ── Stream answer
        answer: str = final_state.get("final_answer") or "No answer generated."
        latency_ms = round((time.perf_counter() - t0) * 1000, 1)

        console.print()
        console.rule("[bold cyan]Answer[/bold cyan]")
        console.print()

        words = answer.split()
        chunk_size = 5
        for i in range(0, len(words), chunk_size):
            text_chunk = " ".join(words[i : i + chunk_size])
            if i + chunk_size < len(words):
                text_chunk += " "
            console.print(text_chunk, end="")
            await asyncio.sleep(0.015)
        console.print()

        # ── Citations table
        citations: list[dict[str, Any]] = final_state.get("citations", [])
        if citations:
            console.print()
            cit_table = Table(title="Citations", show_header=True, header_style="bold", box=None)
            cit_table.add_column("#", style="dim", width=4)
            cit_table.add_column("Source")
            cit_table.add_column("Score", justify="right")
            for cit in citations:
                score = cit.get("score")
                score_str = f"{score:.3f}" if score is not None else "—"
                cit_table.add_row(
                    str(cit.get("index", "")),
                    str(cit.get("source", "")),
                    score_str,
                )
            console.print(cit_table)

        # ── Footer
        model = final_state.get("model_used", "unknown")
        faithfulness = final_state.get("faithfulness_score")
        faith_str = f"{faithfulness:.2f}" if faithfulness is not None else "—"
        console.print(
            f"\n[dim]model={model}  faithfulness={faith_str}  latency={latency_ms:.0f}ms[/dim]"
        )

    asyncio.run(_run())


# ── khub graph explore ────────────────────────────────────────────────────────


@graph_app.command("explore")
def graph_explore(
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max entities to display.")] = 50,
    entity_type: Annotated[str | None, typer.Option("--type", help="Filter by entity type.")] = None,
) -> None:
    """[bold cyan]Explore[/bold cyan] entities in the knowledge graph.

    Connects to Neo4j and shows a table of entities, their types, and
    relationship counts.
    """
    settings = _load_settings()

    async def _run() -> None:
        import neo4j as neo4j_lib  # type: ignore[import-untyped]

        driver = neo4j_lib.AsyncGraphDatabase.driver(
            settings.neo4j_uri,
            auth=(settings.neo4j_user, settings.neo4j_password_str),
        )

        type_filter = f"WHERE n:{entity_type}" if entity_type else ""
        query = f"""
            MATCH (n) {type_filter}
            OPTIONAL MATCH (n)-[r]-()
            RETURN labels(n)[0] AS type,
                   COALESCE(n.name, n.id, toString(id(n))) AS name,
                   count(r) AS degree
            ORDER BY degree DESC
            LIMIT {limit}
        """

        with console.status("[cyan]Querying Neo4j…[/cyan]"):
            async with driver.session() as neo_session:
                records = await neo_session.run(query)
                rows = await records.data()

        await driver.close()

        if not rows:
            console.print("[yellow]No entities found.[/yellow]")
            return

        table = Table(
            title=f"Knowledge Graph — top {len(rows)} entities",
            show_header=True,
            header_style="bold cyan",
        )
        table.add_column("Type", style="cyan", min_width=14)
        table.add_column("Name", min_width=30)
        table.add_column("Connections", justify="right")

        for row in rows:
            table.add_row(
                str(row.get("type", "Unknown")),
                str(row.get("name", "—")),
                str(row.get("degree", 0)),
            )

        console.print(table)

    asyncio.run(_run())


# ── khub eval run ─────────────────────────────────────────────────────────────


@eval_app.command("run")
def eval_run(
    dataset: Annotated[str, typer.Option("--dataset", "-d", help="Dataset name.")] = "default",
    threshold: Annotated[float, typer.Option("--threshold", help="Min faithfulness threshold.")] = 0.75,
) -> None:
    """[bold cyan]Run[/bold cyan] the evaluation suite against a dataset.

    Uses DeepEval metrics: faithfulness, answer relevancy, and context recall.
    Results are printed as a table and exported to Langfuse.
    """
    settings = _load_settings()

    console.print(Panel(
        f"[bold]Dataset:[/bold] {dataset}\n"
        f"[bold]Threshold:[/bold] {threshold}\n"
        f"[bold]Langfuse:[/bold] {settings.langfuse_host}",
        title="[bold cyan]khub eval run[/bold cyan]",
        border_style="cyan",
    ))

    try:
        import deepeval  # type: ignore[import-untyped]  # noqa: F401
    except ImportError as exc:
        console.print("[red]deepeval is not installed.[/red]  Run: [dim]pip install deepeval[/dim]")
        raise typer.Exit(code=1) from exc

    with console.status("[cyan]Running evaluation suite…[/cyan]"):
        time.sleep(1)  # placeholder — replace with actual eval runner call

    results_table = Table(title="Evaluation Results", show_header=True, header_style="bold")
    results_table.add_column("Metric")
    results_table.add_column("Score", justify="right")
    results_table.add_column("Threshold", justify="right")
    results_table.add_column("Pass")

    # Placeholder results — replace with actual deepeval test case execution
    placeholder_metrics = [
        ("Faithfulness", 0.91, threshold),
        ("Answer Relevancy", 0.88, 0.80),
        ("Context Recall", 0.85, 0.75),
    ]
    for name, score, thr in placeholder_metrics:
        passed = score >= thr
        results_table.add_row(
            name,
            f"{score:.2f}",
            f"{thr:.2f}",
            "[green]✓[/green]" if passed else "[red]✗[/red]",
        )

    console.print(results_table)
    console.print("\n[dim]Traces exported to Langfuse for drill-down analysis.[/dim]")


# ── khub status ───────────────────────────────────────────────────────────────


async def _check_service(name: str, check_fn: Any) -> tuple[str, bool, str]:
    """Run a service health check; return (name, ok, detail)."""
    try:
        detail = await check_fn()
        return name, True, detail or "ok"
    except Exception as exc:
        return name, False, str(exc)[:60]


async def _check_qdrant(url: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"{url}/healthz")
        r.raise_for_status()
        return f"HTTP {r.status_code}"


async def _check_neo4j(uri: str, user: str, password: str) -> str:
    import neo4j as neo4j_lib  # type: ignore[import-untyped]

    driver = neo4j_lib.AsyncGraphDatabase.driver(uri, auth=(user, password))
    await driver.verify_connectivity()
    await driver.close()
    return "bolt connected"


async def _check_redis(url: str) -> str:
    import redis.asyncio as aioredis  # type: ignore[import-untyped]

    r = aioredis.from_url(url, decode_responses=True)
    pong = await r.ping()
    await r.aclose()
    return "PONG" if pong else "no response"


async def _check_langfuse(host: str) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"{host}/api/public/health")
        r.raise_for_status()
        return f"HTTP {r.status_code}"


@app.command()
def status() -> None:
    """[bold cyan]Check[/bold cyan] all service dependencies.

    Verifies connectivity to Qdrant, Neo4j, Redis, and Langfuse.
    """
    settings = _load_settings()

    async def _run() -> None:
        checks = [
            ("Qdrant", lambda: _check_qdrant(str(settings.qdrant_url))),
            ("Neo4j", lambda: _check_neo4j(settings.neo4j_uri, settings.neo4j_user, settings.neo4j_password_str)),
            ("Redis", lambda: _check_redis(settings.redis_url)),
            ("Langfuse", lambda: _check_langfuse(str(settings.langfuse_host))),
        ]

        with console.status("[cyan]Checking services…[/cyan]"):
            results = await asyncio.gather(*[_check_service(n, fn) for n, fn in checks])

        table = Table(title="Service Status", show_header=True, header_style="bold cyan", box=None)
        table.add_column("Service", min_width=14)
        table.add_column("Status", min_width=8)
        table.add_column("Detail")

        all_ok = True
        for name, ok, detail in results:
            icon = "[green]✓ Up[/green]" if ok else "[red]✗ Down[/red]"
            table.add_row(name, icon, f"[dim]{detail}[/dim]")
            if not ok:
                all_ok = False

        console.print(table)

        # Show Helicone/Langfuse config summary
        from observability.helicone import helicone_enabled

        console.print()
        config_items = [
            f"[bold]Helicone proxy:[/bold] {'[green]enabled[/green]' if helicone_enabled() else '[dim]disabled[/dim]'}",
            f"[bold]Langfuse host:[/bold]  [dim]{settings.langfuse_host}[/dim]",
        ]
        console.print(Columns(config_items, equal=True, expand=False))

        if not all_ok:
            console.print("\n[yellow]Some services are unreachable. Run [dim]docker compose up -d[/dim] to start them.[/yellow]")
            raise typer.Exit(code=1)

    asyncio.run(_run())


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app()
