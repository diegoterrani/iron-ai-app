interface FieldProps {
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

/** Campo de formulário com rótulo e erro acessíveis (aria-describedby). */
export function Field({ name, label, type = "text", autoComplete, error, hint, required = true }: FieldProps) {
  const describedBy = [error ? `${name}-erro` : null, hint ? `${name}-dica` : null].filter(Boolean).join(" ");
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint && (
        <p id={`${name}-dica`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${name}-erro`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
