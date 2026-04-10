import { Field, TextArea } from './shared';

interface Props {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}

export function TransformConfigEditor({ config, onChange }: Props) {
  return (
    <>
      <Field label="Expression" required hint="JS expression. Use inputs.* and context.* — return an object">
        <TextArea
          value={(config.expression as string) ?? ''}
          onChange={(v) => onChange({ ...config, expression: v })}
          placeholder="({ result: inputs.x + inputs.y })"
          rows={10}
          mono
        />
      </Field>
    </>
  );
}
