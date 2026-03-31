"use client";

import type { ComponentProps } from "react";
import { Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";

function SearchInput({
  className,
  ...props
}: ComponentProps<"input">) {
  return (
    <InputGroup className={cn(className)}>
      <InputGroupAddon>
        <InputGroupText>
          <Search className="size-4" />
        </InputGroupText>
      </InputGroupAddon>
      <InputGroupInput type="search" {...props} />
    </InputGroup>
  );
}

export { SearchInput };
