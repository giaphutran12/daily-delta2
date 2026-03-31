"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

export interface EntitySearchOption<T = unknown> {
  id: string;
  label: string;
  subtitle?: string | null;
  meta?: string | null;
  disabled?: boolean;
  value: T;
}

interface EntitySearchComboboxProps<T = unknown> {
  query: string;
  onQueryChange: (query: string) => void;
  options: EntitySearchOption<T>[];
  onSelectOption: (option: EntitySearchOption<T>) => void | Promise<void>;
  onSubmitQuery?: (query: string) => void | Promise<void>;
  placeholder: string;
  emptyMessage: string;
  disabled?: boolean;
  loading?: boolean;
  submitLabel?: string;
}

function EntitySearchCombobox<T = unknown>({
  query,
  onQueryChange,
  options,
  onSelectOption,
  onSubmitQuery,
  placeholder,
  emptyMessage,
  disabled = false,
  loading = false,
  submitLabel,
}: EntitySearchComboboxProps<T>) {
  const [highlightedOption, setHighlightedOption] =
    useState<EntitySearchOption<T>>();

  useEffect(() => {
    setHighlightedOption(undefined);
  }, [query]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Combobox<EntitySearchOption<T>>
          items={options}
          filteredItems={options}
          filter={null}
          value={null}
          inputValue={query}
          onInputValueChange={onQueryChange}
          onValueChange={(value) => {
            if (value) {
              void onSelectOption(value);
            }
          }}
          onItemHighlighted={(value) => setHighlightedOption(value)}
          itemToStringLabel={(item) => item.label}
          itemToStringValue={(item) => item.id}
          autoHighlight={false}
          highlightItemOnHover
        >
          <ComboboxInput
            className="w-full"
            placeholder={placeholder}
            disabled={disabled}
            showTrigger={false}
            showClear={query.trim().length > 0}
            onKeyDown={(event) => {
              if (event.key === "Enter" && onSubmitQuery && !highlightedOption) {
                event.preventDefault();
                void onSubmitQuery(query);
              }
            }}
          />
          <ComboboxContent>
            <ComboboxEmpty>
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  Searching...
                </span>
              ) : (
                emptyMessage
              )}
            </ComboboxEmpty>
            <ComboboxList>
              {options.map((option, index) => (
                <ComboboxItem
                  key={option.id}
                  index={index}
                  value={option}
                  disabled={option.disabled}
                >
                  <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{option.label}</span>
                      {option.subtitle ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {option.subtitle}
                        </span>
                      ) : null}
                    </div>
                    {option.meta ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {option.meta}
                      </span>
                    ) : null}
                  </div>
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>

        {submitLabel ? (
          <Button
            type="button"
            disabled={disabled || !query.trim()}
            onClick={() => {
              if (onSubmitQuery) {
                void onSubmitQuery(query);
              }
            }}
          >
            {submitLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export { EntitySearchCombobox };
