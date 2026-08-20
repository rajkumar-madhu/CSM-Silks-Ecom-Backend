type AdminChoiceOption<T extends string> = {
  value: T;
  label: string;
};

export function AdminChoice<T extends string>({
  value,
  onChange,
  options,
  label,
  wrap = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: AdminChoiceOption<T>[];
  label?: string;
  wrap?: boolean;
}) {
  return (
    <div className={`admin-choice ${wrap ? 'is-wrap' : ''}`}>
      {label ? <span className="admin-choice-label">{label}</span> : null}
      <div className="admin-choice-track" role="radiogroup" aria-label={label || 'Choose an option'}>
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={option.value || 'all'}
              type="button"
              role="radio"
              aria-checked={on}
              className={on ? 'on' : ''}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
