import { useState } from "react";
import { Upload, Grid, List, RefreshCw, Trash2, Network } from "lucide-react";

interface Document {
  id: string;
  name: string;
  pages: number;
  chunks: number;
  nodes: number;
  ingested: string;
  status: "indexed" | "processing" | "failed";
  size: string;
}

export default function Documents() {
  const [view, setView] = useState<"table" | "grid">("table");
  const [documents, setDocuments] = useState<Document[]>([
    { id: "1", name: "Introduction_to_Neural_Networks.pdf", pages: 234, chunks: 847, nodes: 234, ingested: "2026-04-01", status: "indexed", size: "3.2 MB" },
    { id: "2", name: "Deep_Learning_Fundamentals.pdf", pages: 456, chunks: 1432, nodes: 567, ingested: "2026-04-02", status: "indexed", size: "5.8 MB" },
    { id: "3", name: "Machine_Learning_Basics.pdf", pages: 189, chunks: 623, nodes: 189, ingested: "2026-04-03", status: "indexed", size: "2.1 MB" },
    { id: "4", name: "RAG_Systems_Overview.pdf", pages: 78, chunks: 312, nodes: 98, ingested: "2026-04-04", status: "processing", size: "1.4 MB" },
  ]);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    simulateUpload();
  };

  const simulateUpload = () => {
    setIsUploading(true);
    setUploadProgress(0);
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsUploading(false);
            setUploadProgress(0);
          }, 500);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "indexed":
        return { bg: 'rgba(0, 196, 140, 0.12)', color: '#00C48C', border: 'rgba(0, 196, 140, 0.25)' };
      case "processing":
        return { bg: 'rgba(255, 181, 71, 0.12)', color: '#FFB547', border: 'rgba(255, 181, 71, 0.25)' };
      case "failed":
        return { bg: 'rgba(255, 77, 106, 0.12)', color: '#FF4D6A', border: 'rgba(255, 77, 106, 0.25)' };
      default:
        return { bg: 'var(--surface)', color: 'var(--text-secondary)', border: 'var(--border)' };
    }
  };

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--background)' }}>
      <div className="flex-1 overflow-hidden p-6">
        <div className="max-w-[1400px] mx-auto h-full flex gap-6">
          {/* Upload Zone */}
          <div className="w-[300px] flex-shrink-0">
            {!isUploading ? (
              <div
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={simulateUpload}
                className="h-[200px] rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-200 hover:scale-[1.02]"
                style={{
                  border: '2px dashed var(--border)',
                  background: 'var(--surface)',
                }}
              >
                <Upload size={32} style={{ color: 'var(--accent-teal)', marginBottom: '12px' }} />
                <div
                  className="text-[13px] text-center px-4"
                  style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                >
                  Drop PDFs here or click to upload
                </div>
              </div>
            ) : (
              <div
                className="h-[200px] rounded-2xl p-4 flex flex-col justify-between"
                style={{
                  background: 'var(--elevated)',
                  border: '1px solid var(--border)',
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[12px]" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                      Ignition_Core.pdf
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      3.2 MB
                    </span>
                  </div>
                  <div className="w-full h-1 rounded-full overflow-hidden mb-3" style={{ background: 'var(--border)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-200"
                      style={{ background: 'var(--accent-teal)', width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: uploadProgress >= 25 ? 'var(--success)' : 'var(--accent-teal)' }} />
                      <span className="text-[10px]" style={{ color: uploadProgress >= 25 ? 'var(--success)' : 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        Parsing
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: uploadProgress >= 50 ? 'var(--success)' : uploadProgress >= 25 ? 'var(--accent-teal)' : 'var(--border)' }} />
                      <span className="text-[10px]" style={{ color: uploadProgress >= 50 ? 'var(--success)' : uploadProgress >= 25 ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        Chunking
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: uploadProgress >= 75 ? 'var(--success)' : uploadProgress >= 50 ? 'var(--accent-teal)' : 'var(--border)' }} />
                      <span className="text-[10px]" style={{ color: uploadProgress >= 75 ? 'var(--success)' : uploadProgress >= 50 ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        Embedding
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: uploadProgress >= 100 ? 'var(--success)' : uploadProgress >= 75 ? 'var(--accent-teal)' : 'var(--border)' }} />
                      <span className="text-[10px]" style={{ color: uploadProgress >= 100 ? 'var(--success)' : uploadProgress >= 75 ? 'var(--text-secondary)' : 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                        Graph
                      </span>
                    </div>
                  </div>
                </div>
                <div className="text-[10px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  Stage {Math.floor(uploadProgress / 25) + 1} of 4 • {uploadProgress}% complete
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="mt-6 space-y-4">
              <div
                className="p-4 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="text-[11px] mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  TOTAL DOCUMENTS
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                  {documents.length}
                </div>
              </div>
              <div
                className="p-4 rounded-lg"
                style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="text-[11px] mb-1" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  TOTAL CHUNKS
                </div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: '32px', color: 'var(--text-primary)' }}>
                  {documents.reduce((sum, doc) => sum + doc.chunks, 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Document List */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '28px', color: 'var(--text-primary)' }}>
                Documents
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setView("table")}
                  className="p-2 rounded transition-colors"
                  style={{
                    background: view === "table" ? 'var(--elevated)' : 'transparent',
                    color: view === "table" ? 'var(--accent-teal)' : 'var(--text-secondary)'
                  }}
                >
                  <List size={16} />
                </button>
                <button
                  onClick={() => setView("grid")}
                  className="p-2 rounded transition-colors"
                  style={{
                    background: view === "grid" ? 'var(--elevated)' : 'transparent',
                    color: view === "grid" ? 'var(--accent-teal)' : 'var(--text-secondary)'
                  }}
                >
                  <Grid size={16} />
                </button>
              </div>
            </div>

            {/* Table View */}
            {view === "table" && (
              <div className="flex-1 overflow-y-auto">
                <table className="w-full">
                  <thead
                    className="sticky top-0"
                    style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                  >
                    <tr>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        NAME
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        PAGES
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        CHUNKS
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        NODES
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        INGESTED
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        STATUS
                      </th>
                      <th
                        className="text-left py-3 px-4 text-[11px]"
                        style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}
                      >
                        ACTIONS
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((doc) => {
                      const statusColors = getStatusColor(doc.status);
                      return (
                        <tr
                          key={doc.id}
                          className="group transition-colors"
                          style={{ borderBottom: '1px solid var(--border)' }}
                        >
                          <td
                            className="py-3 px-4 text-[13px]"
                            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.name}
                          </td>
                          <td
                            className="py-3 px-4 text-[13px]"
                            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.pages}
                          </td>
                          <td
                            className="py-3 px-4 text-[13px]"
                            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.chunks.toLocaleString()}
                          </td>
                          <td
                            className="py-3 px-4 text-[13px]"
                            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.nodes}
                          </td>
                          <td
                            className="py-3 px-4 text-[13px]"
                            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.ingested}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className="px-2 py-1 rounded text-[11px]"
                              style={{
                                background: statusColors.bg,
                                color: statusColors.color,
                                border: `1px solid ${statusColors.border}`,
                                fontFamily: 'var(--font-mono)'
                              }}
                            >
                              {doc.status}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                className="p-1.5 rounded transition-colors"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <RefreshCw size={14} />
                              </button>
                              <button
                                className="p-1.5 rounded transition-colors"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                <Network size={14} />
                              </button>
                              <button
                                className="p-1.5 rounded transition-colors"
                                style={{ color: 'var(--danger)' }}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Grid View */}
            {view === "grid" && (
              <div className="flex-1 overflow-y-auto">
                <div className="grid grid-cols-3 gap-4">
                  {documents.map((doc) => {
                    const statusColors = getStatusColor(doc.status);
                    const hash = doc.name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    const hue = hash % 360;
                    return (
                      <div
                        key={doc.id}
                        className="rounded-xl overflow-hidden transition-transform duration-200 hover:scale-[1.02] cursor-pointer"
                        style={{ border: '1px solid var(--border)', background: 'var(--elevated)' }}
                      >
                        <div
                          className="h-24"
                          style={{ background: `hsl(${hue}, 30%, 25%)` }}
                        />
                        <div className="p-4">
                          <div
                            className="text-[13px] mb-2 truncate"
                            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                          >
                            {doc.name}
                          </div>
                          <div className="flex items-center justify-between mb-3 text-[11px]" style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            <span>{doc.pages} pages</span>
                            <span>{doc.nodes} nodes</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span
                              className="px-2 py-1 rounded text-[10px]"
                              style={{
                                background: statusColors.bg,
                                color: statusColors.color,
                                border: `1px solid ${statusColors.border}`,
                                fontFamily: 'var(--font-mono)'
                              }}
                            >
                              {doc.status}
                            </span>
                            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                              {doc.ingested}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
