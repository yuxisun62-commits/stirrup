import { TransformConfigEditor } from './TransformConfig';
import { ConditionConfigEditor } from './ConditionConfig';
import { HttpConfigEditor } from './HttpConfig';
import { ScriptConfigEditor } from './ScriptConfig';
import { LlmPromptConfigEditor } from './LlmPromptConfig';
import { AgentToolUseConfigEditor } from './AgentToolUseConfig';
import { DecisionRoutingConfigEditor } from './DecisionRoutingConfig';
import { CodeGenerationConfigEditor } from './CodeGenerationConfig';
import { GenericConfigEditor } from './GenericConfig';

interface Props {
  type: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
}

const EDITORS: Record<string, React.ComponentType<{ config: Record<string, unknown>; onChange: (c: Record<string, unknown>) => void }>> = {
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
  const Editor = EDITORS[type] ?? GenericConfigEditor;
  return <Editor config={config} onChange={onChange} />;
}
