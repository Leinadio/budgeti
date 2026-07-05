"use client";
import * as React from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function RuleCheckboxField({ name, label }: { name: string; label: string }) {
  const [checked, setChecked] = React.useState(false);
  return (
    <Label className="text-xs font-normal">
      <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
      {checked && <input type="hidden" name={name} value="on" />}
      {label}
    </Label>
  );
}
