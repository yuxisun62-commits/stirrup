import { Field, TextArea } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function ConditionConfigEditor({ config, onChange }: Props) {
  return (
    <>
      <Field label="Expression" required hint="Must return a branch name string (e.g. 'yes' or 'no')">
        <TextArea
          value={(config.expression as string) ?? ''}
          onChange={(v) => onChange({ ...config, expression: v })}
          placeholder="inputs.value > 50 ? 'high' : 'low'"
          rows={3}
          mono
        />
      </Field>
    </>
  );
}
