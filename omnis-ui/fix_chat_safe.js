const fs = require('fs');

const file = 'src/app/pages/Chat.tsx';
let data = fs.readFileSync('../omnis-ui-inspiration/' + file, 'utf8');

// Replace imports
data = data.replace(
  'import { useState, useEffect, useRef } from "react";',
  `import { useState, useEffect, useRef, Dispatch, SetStateAction, RefObject, useMemo } from "react";
import { getSessionId } from "../lib/api";
import { streamAsk, type AskStreamEvent } from "../lib/askStream";
import CitationRichText from "../components/chat/CitationRichText";
import { SpanCard, TreeView, type TraceStep } from "../components/traces/AgentPrism";`
);

// Replace mock Interface Message with real one
data = data.replace(
  /interface Message \{\s*id: string;\s*role: "user" \| "assistant";\s*content: string;\s*citations\?: \{[^}]*\}\[\];\s*agentStatus\?: \{[^}]*\}\[\];\s*\}/,
  `interface Citation { index: number; source: string; chunkId?: string; score?: number; title: string; excerpt: string; }
interface Message { id: string; role: "user" | "assistant"; content: string; citations: Citation[]; latencyMs?: number; modelUsed?: string; }
type SetMessages = Dispatch<SetStateAction<Message[]>>;
type SetTraceSteps = Dispatch<SetStateAction<TraceStep[]>>;

function upsertTraceStep(existing: TraceStep[], node: string, patch: Partial<TraceStep>): TraceStep[] {
  const id = \`trace-\${node}\`;
  const idx = existing.findIndex((step) => step.id === id);
  if (idx === -1) return [...existing, { id, node, title: node[0].toUpperCase() + node.slice(1), status: "pending", ...patch }];
  const copy = [...existing]; copy[idx] = { ...copy[idx], ...patch }; return copy;
}
function updateAssistantMessage(messages: Message[], assistantId: string, updater: (message: Message) => Message): Message[] {
  return messages.map((message) => message.id === assistantId ? updater(message) : message);
}
function applyDelta(setMessages: SetMessages, assistantId: string, content: string): void {
  setMessages((prev) => updateAssistantMessage(prev, assistantId, (message) => ({ ...message, content: \`\${message.content}\${content}\` })));
}
function citationFromEvent(event: Extract<AskStreamEvent, { type: "citation" }>): Citation {
  const sourceName = event.source?.split("/").pop() ?? "source";
  return { index: event.index, source: event.source, chunkId: event.chunk_id ?? undefined, score: event.score ?? undefined, title: sourceName.replace(/\\.[a-zA-Z0-9]+$/, ""), excerpt: \`Chunk \${event.chunk_id ?? "unknown"} from \${sourceName}\` };
}
function applyCitation(setMessages: SetMessages, assistantId: string, event: Extract<AskStreamEvent, { type: "citation" }>): void {
  setMessages((prev) => updateAssistantMessage(prev, assistantId, (message) => {
    if (message.citations.some((citation) => citation.index === event.index)) return message;
    return { ...message, citations: [...message.citations, citationFromEvent(event)] };
  }));
}
function applyFinal(setMessages: SetMessages, assistantId: string, event: Extract<AskStreamEvent, { type: "final" }>): void {
  setMessages((prev) => updateAssistantMessage(prev, assistantId, (message) => ({ ...message, content: message.content || event.answer, latencyMs: event.latency_ms, modelUsed: event.model_used })));
}
function applyTraceEvent(setTraceSteps: SetTraceSteps, event: AskStreamEvent): void {
  if (event.type === "tool_start") { setTraceSteps((prev) => upsertTraceStep(prev, event.node, { title: event.node[0].toUpperCase() + event.node.slice(1), status: "running", startedAt: Math.round(event.ts * 1000) })); return; }
  if (event.type === "tool_result") { setTraceSteps((prev) => upsertTraceStep(prev, event.node, { status: "completed", endedAt: Math.round(event.ts * 1000), data: event.data })); return; }
  if (event.type === "cache_hit") { setTraceSteps((prev) => upsertTraceStep(prev, "cache", { title: \`Cache hit (\${event.layer})\`, status: "completed", data: { similarity: event.similarity ?? null } })); return; }
  if (event.type === "error") { setTraceSteps((prev) => upsertTraceStep(prev, "error", { title: "Pipeline error", status: "failed", data: { detail: event.detail } })); }
}
function buildAskEventApplier(context: { activeAssistantIdRef: RefObject<string | null>; setMessages: SetMessages; setTraceSteps: SetTraceSteps; scrollToEnd: () => void }) {
  return (event: AskStreamEvent) => {
    const assistantId = context.activeAssistantIdRef.current; if (!assistantId) return;
    if (event.type === "delta") { applyDelta(context.setMessages, assistantId, event.content); context.scrollToEnd(); return; }
    if (event.type === "citation") { applyCitation(context.setMessages, assistantId, event); return; }
    if (event.type === "final") { applyFinal(context.setMessages, assistantId, event); return; }
    applyTraceEvent(context.setTraceSteps, event);
  };
}`
);

// Replace component state
data = data.replace(
  'const messagesEndRef = useRef<HTMLDivElement>(null);',
  `const messagesEndRef = useRef<HTMLDivElement>(null);
  const [traceSteps, setTraceSteps] = useState<TraceStep[]>([]);
  const activeAssistantIdRef = useRef<string | null>(null);
  
  const applyEvent = useMemo(() => buildAskEventApplier({ activeAssistantIdRef, setMessages, setTraceSteps, scrollToEnd: () => requestAnimationFrame(() => scrollToBottom()) }), []);`
);

// Remove simulateStreaming completely
data = data.replace(/const simulateStreaming = [\s\S]*?(?=const handleSend)/, '');

data = data.replace(
  /const handleSend = \(question\?: string\) => \{[\s\S]*?\};\s*const suggestedQuestions/m,
  `const handleSend = async (question?: string) => {
    const text = question || input;
    if (!text.trim()) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text, citations: [] }]);
    setInput(""); setIsStreaming(true);
    const assistantMsg: Message = { id: crypto.randomUUID(), role: "assistant", content: "", citations: [] };
    activeAssistantIdRef.current = assistantMsg.id;
    setMessages((prev) => [...prev, assistantMsg]); setTraceSteps([]);
    try { await streamAsk({ question: text, tenant_id: "default", session_id: getSessionId() }, applyEvent); }
    catch(e) { console.error(e); }
    finally { setIsStreaming(false); scrollToBottom(); }
  };

  const suggestedQuestions`
);

// Replace message content render (which is inside a prose div)
// Searching for the Assistant message text rendering block
data = data.replace(
  /<div className="prose prose-sm dark:prose-invert max-w-none text-\[#4b5563\] dark:text-\[#d1d5db\] leading-relaxed space-y-4">\s*\{msg\.content.split\([\s\S]*?<\/div>/,
  `<div><CitationRichText content={msg.content} citations={msg.citations || []} onCitationClick={() => {}} /></div>`
);

// Replace the citations map
data = data.replace(
  /\{msg\.citations && msg\.citations\.length > 0 && \([\s\S]*?<\/div>\s*\)\}/,
  `` // CitationRichText already handles this now.
);

data = data.replace(
  /\{messages\[messages.length - 1\]\?.agentStatus \? \([\s\S]*?<div className="px-5 py-4 border-t/m,
  `
    <div className="flex-1 p-4 overflow-y-auto text-sm space-y-4">
       {traceSteps.map(step => (
          <SpanCard key={step.id} step={step} />
       ))}
       {traceSteps.length === 0 && <div className="text-muted-foreground p-5">No active trace...</div>}
    </div>
    <div className="px-5 py-4 border-t`
);

fs.writeFileSync(file, data);

// -------- Knowledge Graph --------
const graphFile = 'src/app/pages/KnowledgeGraph.tsx';
let gdata = fs.readFileSync('../omnis-ui-inspiration/' + graphFile, 'utf8');

gdata = gdata.replace(
  `import { useState, useRef } from "react";
import { Info, ExternalLink, Network, FileText, ChevronRight, X, Maximize2, Search, Filter, Play, Share2 } from "lucide-react";`,
  `import { useState, useRef, useEffect } from "react";
import { Info, ExternalLink, Network, FileText, ChevronRight, X, Maximize2, Search, Filter, Play, Share2 } from "lucide-react";
import { SigmaContainer, ControlsContainer, ZoomControl, FullScreenControl } from "@react-sigma/core";
import { Graph } from "graphology";
import circular from "graphology-layout/circular";
import forceAtlas2 from "graphology-layout-forceatlas2";
import louvain from "graphology-communities-louvain";
import { streamGraphExplore } from "../lib/graphStream";
import "@react-sigma/core/lib/style.css";

const COMMUNITY_COLORS = ["#3b82f6", "#ef4444", "#10b981", "#f59e0b", "#8b5cf6", "#6366f1", "#ec4899", "#14b8a6"];
function colorForCommunity(communityId: number = 0) { return COMMUNITY_COLORS[communityId % COMMUNITY_COLORS.length]; }`
);

// remove the simulated nodes array
gdata = gdata.replace(/const simulatedNodes = [\s\S]*?(?=export default function KnowledgeGraph)/, '');

gdata = gdata.replace(
  /export default function KnowledgeGraph\(\) \{/,
  `export default function KnowledgeGraph() {
  const [graph] = useState(() => new Graph({ multi: true, allowSelfLoops: true }));
  const [loading, setLoading] = useState(false);
  const [loadedEdges, setLoadedEdges] = useState(0);

  useEffect(() => {
    let canceled = false;
    async function load() {
      setLoading(true);
      try {
        const stream = streamGraphExplore({ tenant_id: "default", limit: 500 });
        for await (const event of stream) {
          if (canceled) break;
          if (event.type === "node") {
            if (!graph.hasNode(event.id)) {
              graph.addNode(event.id, { label: event.label, size: Math.max(3, Math.min(20, Math.sqrt(event.degree || 1) * 3)), entity_type: event.entity_type, x: event.x ?? Math.random(), y: event.y ?? Math.random(), color: "#9ca3af" });
            }
          } else if (event.type === "edge") {
            if (!graph.hasEdge(event.source, event.target)) {
              if (graph.hasNode(event.source) && graph.hasNode(event.target)) {
                graph.addEdge(event.source, event.target, { size: 1, color: "#e5e7eb", label: event.relation });
                setLoadedEdges((prev) => prev + 1);
              }
            }
          }
        }
      } catch (e) {
      } finally {
        if (!canceled && graph.order > 0) {
          try {
             louvain.assign(graph);
             graph.forEachNode((node, attr) => { if (attr.community !== undefined) graph.setNodeAttribute(node, "color", colorForCommunity(attr.community as number)); });
          } catch(e) {}
          circular.assign(graph);
          forceAtlas2.assign(graph, { iterations: 100, settings: { gravity: 0.5 } });
        }
        setLoading(false);
      }
    }
    load();
    return () => { canceled = true; graph.clear(); };
  }, [graph]);
`
);

// Replace the graph container UI injection
gdata = gdata.replace(
  /<div className="w-full h-full relative" id="graph-container">([\s\S]*?)<\/div> <!-- end graph container -->/,
  `<div className="w-full h-full relative" id="graph-container">
      <SigmaContainer graph={graph} settings={{ renderEdgeLabels: true, labelDensity: 1.5, labelSize: 12 }}>
        <ControlsContainer position={"bottom-right"}>
            <ZoomControl />
            <FullScreenControl />
        </ControlsContainer>
      </SigmaContainer>
      {loading && (
        <div className="absolute inset-0 z-10 bg-background/50 flex flex-col items-center justify-center backdrop-blur-sm pointer-events-none">
          <div className="animate-pulse text-lg font-medium">Ingesting sub-graph topology...</div>
          <div className="text-sm mt-2 text-muted-foreground">{loadedEdges} edges streaming...</div>
        </div>
      )}
   </div>`
);

fs.writeFileSync(graphFile, gdata);
