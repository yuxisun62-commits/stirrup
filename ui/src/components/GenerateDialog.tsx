import { useState } from 'react';
import { generateWorkflow, type WorkflowDefinition } from '../api/client';
import { tokens, monoInput } from './ui/styles';

interface Props {
  onGenerated: (wf: WorkflowDefinition) => void;
  onClose: () => void;
}

const EXAMPLES = [
  "A CI/CD pipeline that runs tests, builds a Docker image, and deploys to staging",
  "Monitor a website every hour, check if it's down, and send a Slack alert if so",
  "Process customer support emails: classify by topic, route urgent ones to on-call, draft responses for the rest",
  "Scrape an API for new data, enrich it with AI, and insert into a database",
  "Review pull requests: fetch the diff, analyze for bugs, and post a summary comment",
];

export function GenerateDialog({ onGenerated, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const wf = await generateWorkflow(prompt.trim());
      // Ensure unique ID
      wf.id = wf.id ?? `generated-${Date.now().toString(36)}`;
      onGenerated(wf);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 580, maxHeight: '85vh', borderRadius: 12,
          backgroundColor: tokens.bg.surface, border: `1px solid ${tokens.border.subtle}`,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${tokens.border.subtle}`,
          background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}10 0%, transparent 60%)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#fff',
            }}>
              AI
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: tokens.text.primary }}>Generate Workflow</div>
              <div style={{ fontSize: 11, color: tokens.text.muted }}>Describe what you want and AI will build the workflow</div>
            </div>
          </div>
        </div>

        {/* Prompt input */}
        <div style={{ padding: '16px 20px' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the workflow you want to create...&#10;&#10;Example: A pipeline that fetches data from an API, validates it, uses AI to categorize each item, and stores the results in a database"
            style={{
              ...monoInput,
              height: 120,
              resize: 'vertical',
              fontSize: 13,
              lineHeight: 1.6,
              fontFamily: tokens.font.sans,
            }}
            onFocus={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.focus; }}
            onBlur={(e) => { (e.target as HTMLElement).style.borderColor = tokens.border.subtle; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
            autoFocus
          />
          <div style={{ fontSize: 10, color: tokens.text.muted, marginTop: 4 }}>
            Ctrl+Enter to generate
          </div>
        </div>

        {/* Examples */}
        <div style={{ padding: '0 20px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: tokens.text.muted, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 6 }}>
            Try an example
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {EXAMPLES.map((ex, i) => (
              <button
                key={i}
                onClick={() => setPrompt(ex)}
                style={{
                  padding: '4px 8px', fontSize: 10, borderRadius: 4,
                  border: `1px solid ${tokens.border.subtle}`,
                  backgroundColor: prompt === ex ? `${tokens.border.focus}15` : 'transparent',
                  color: prompt === ex ? tokens.text.accent : tokens.text.muted,
                  cursor: 'pointer', textAlign: 'left', lineHeight: 1.3,
                  maxWidth: '100%',
                }}
              >
                {ex.length > 70 ? ex.slice(0, 70) + '...' : ex}
              </button>
            ))}
          </div>
        </div>

        {/* Status / Error */}
        {isGenerating && (
          <div style={{
            padding: '12px 20px',
            display: 'flex', alignItems: 'center', gap: 8,
            borderTop: `1px solid ${tokens.border.subtle}`,
          }}>
            <div style={{
              width: 14, height: 14, borderRadius: '50%',
              border: `2px solid ${tokens.nodeColors['llm-prompt']}`,
              borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
            }} />
            <span style={{ fontSize: 12, color: tokens.text.secondary }}>
              Generating workflow with AI...
            </span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {error && (
          <div style={{
            padding: '10px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
            backgroundColor: `${tokens.status.failed}08`,
          }}>
            <div style={{ fontSize: 11, color: tokens.status.failed }}>{error}</div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${tokens.border.subtle}`,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        }}>
          <button
            onClick={onClose}
            disabled={isGenerating}
            style={{
              padding: '7px 16px', fontSize: 12, borderRadius: 6,
              border: `1px solid ${tokens.border.default}`, backgroundColor: 'transparent',
              color: tokens.text.secondary, cursor: 'pointer', fontWeight: 500,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || isGenerating}
            style={{
              padding: '7px 20px', fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: 'none',
              backgroundColor: prompt.trim() && !isGenerating
                ? `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`
                : tokens.border.default,
              background: prompt.trim() && !isGenerating
                ? `linear-gradient(135deg, ${tokens.nodeColors['llm-prompt']}, ${tokens.nodeColors['decision-routing']})`
                : tokens.border.default,
              color: '#fff',
              cursor: prompt.trim() && !isGenerating ? 'pointer' : 'default',
              opacity: isGenerating ? 0.6 : 1,
            }}
          >
            {isGenerating ? 'Generating...' : 'Generate Workflow'}
          </button>
        </div>
      </div>
    </div>
  );
}
