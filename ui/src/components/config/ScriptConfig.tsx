import { Field, TextArea, NumberInput } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function ScriptConfigEditor({ config, onChange }: Props) {
  return (
    <>
      <Field label="Code" required hint="JS code. Set 'result' to define outputs. Access inputs.* and context.*">
        <TextArea
          value={(config.code as string) ?? ''}
          onChange={(v) => onChange({ ...config, code: v })}
          placeholder={'result = {\n  processed: inputs.data.map(x => x * 2)\n}'}
          rows={10}
          mono
        />
      </Field>
      <Field label="Timeout (ms)" hint="Maximum execution time">
        <NumberInput
          value={config.timeoutMs as number | undefined}
          onChange={(v) => onChange({ ...config, timeoutMs: v })}
          placeholder="10000"
          min={100}
          step={1000}
        />
      </Field>
    </>
  );
}
