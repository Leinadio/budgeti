"use client";
import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function CategorySelectField({
  name,
  categories,
  defaultValue = "",
  placeholder = "À catégoriser",
  className,
}: {
  name: string;
  categories: string[];
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <Select value={value || undefined} onValueChange={setValue}>
        <SelectTrigger size="sm" className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c} value={c}>
              {c}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
