import { TransformConfigEditor } from './TransformConfig';
import { ConditionConfigEditor } from './ConditionConfig';
import { HttpConfigEditor } from './HttpConfig';
import { ScriptConfigEditor } from './ScriptConfig';
import { LlmPromptConfigEditor } from './LlmPromptConfig';
import { AgentToolUseConfigEditor } from './AgentToolUseConfig';
import { DecisionRoutingConfigEditor } from './DecisionRoutingConfig';
import { CodeGenerationConfigEditor } from './CodeGenerationConfig';
import { SchemaFormEditor } from './SchemaFormEditor';
import { AutoFormEditor } from './AutoFormEditor';
import { getNodeSchema } from './schemas';

interface Props {
  type: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

/**
 * Dedicated per-type editors for the 8 built-in core types. These were
 * hand-crafted earlier with specific affordances (JS autocomplete hints,
 * LLM prompt preview, etc.) that the generic schema renderer can't
 * match. Everything else uses a schema (if defined) or the auto-form.
 */
const DEDICATED_EDITORS: Record<string, React.ComponentType<{ config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }>> = {
  'transform': TransformConfigEditor,
  'condition': ConditionConfigEditor,
  'http': HttpConfigEditor,
  'script': ScriptConfigEditor,
  'llm-prompt': LlmPromptConfigEditor,
  'agent-tool-use': AgentToolUseConfigEditor,
  'decision-routing': DecisionRoutingConfigEditor,
  'code-generation': CodeGenerationConfigEditor,
};

export function ConfigEditor({ type, config, onChange }: Props) {
  const Dedicated = DEDICATED_EDITORS[type];
  if (Dedicated) return <Dedicated config={config} onChange={onChange} />;

  const schema = getNodeSchema(type);
  if (schema) return <SchemaFormEditor schema={schema} config={config} onChange={onChange} />;

  // Plugin node without an explicit schema — infer from current config.
  return <AutoFormEditor config={config} onChange={onChange} />;
}
