import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";

type Option = { value: string; label: string };

export function Dropdown({
  label,
  options,
  value,
  onChange,
  placeholder = "Select an option",
  autoFocus,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const selected = options.findIndex((option) => option.value === value);
  const open = active !== null && options.length > 0;
  const activeOption = open ? options[active] : undefined;

  useEffect(() => {
    if (activeOption) {
      document.getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [active, activeOption, id]);

  function choose(option: Option) {
    onChange(option.value);
    setActive(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setActive(null);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const initial = selected >= 0 ? selected : step > 0 ? 0 : options.length - 1;
      setActive(active === null ? initial : Math.max(0, Math.min(options.length - 1, active + step)));
    } else if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : options.length - 1);
    } else if (activeOption && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Tab") {
      setActive(null);
    }
  }

  return (
    <div className="dropdown">
      <span id={`${id}-label`} className="dropdown-label">{label}</span>
      <button
        type="button"
        role="combobox"
        className="dropdown-trigger"
        autoFocus={autoFocus}
        aria-labelledby={`${id}-label`}
        aria-expanded={open}
        aria-controls={open ? `${id}-options` : undefined}
        aria-activedescendant={activeOption ? `${id}-option-${active}` : undefined}
        disabled={!options.length}
        onClick={(event) => {
          event.currentTarget.focus();
          setActive(open ? null : Math.max(0, selected));
        }}
        onBlur={() => setActive(null)}
        onKeyDown={handleKeyDown}
      >
        <span className={selected < 0 ? "dropdown-placeholder" : undefined}>
          {options[selected]?.label ?? placeholder}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropdown-options" id={`${id}-options`} role="listbox" aria-labelledby={`${id}-label`}>
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === selected}
              data-active={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {index === selected && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
