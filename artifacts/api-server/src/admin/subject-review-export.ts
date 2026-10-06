import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";

import type { Product } from "@workspace/db";

import { buildDisplayTopics } from "../domain/subject-normalizer";
import {
  getValidSubjectSummary,
  SUBJECT_SUMMARY_PROMPT_VERSION,
  subjectSourceHash,
} from "../domain/subject-summary";

function boundedExcerpt(value: string): string {
  return value.length <= 320 ? value : `${value.slice(0, 317)}...`;
}

function cell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

const HEADERS = [
  "id",
  "title",
  "description excerpt",
  "original subjects",
  "display topics",
  "summary",
  "status",
  "prompt version",
  "model",
  "source hash",
  "validation/error category",
] as const;

function values(product: Product): string[] {
  const validationCategory =
    product.subjectSummaryError ??
    (product.subjectSummaryStatus === "ready" &&
    getValidSubjectSummary(product, product) === null
      ? product.subjectSummarySourceHash !== subjectSourceHash(product)
        ? "stale_source"
        : "invalid_summary"
      : "");
  return [
    product.id,
    product.title,
    boundedExcerpt(product.description),
    product.subjects.join(" | "),
    buildDisplayTopics({
      subjects: product.subjects,
      tags: product.tags,
    }).join(" | "),
    product.subjectSummary ?? "",
    product.subjectSummaryStatus ?? "",
    product.subjectSummaryPromptVersion ?? SUBJECT_SUMMARY_PROMPT_VERSION,
    product.subjectSummaryModel ?? "",
    product.subjectSummarySourceHash ?? subjectSourceHash(product),
    validationCategory,
  ];
}

export async function exportSubjectReview(
  path: string,
  products: Product[],
): Promise<void> {
  const markdown = [".md", ".markdown"].includes(extname(path).toLowerCase());
  const content = markdown
    ? [
        `| ${HEADERS.join(" | ")} |`,
        `| ${HEADERS.map(() => "---").join(" | ")} |`,
        ...products.map(
          (product) =>
            `| ${values(product)
              .map((value) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " "))
              .join(" | ")} |`,
        ),
      ].join("\n")
    : [
        HEADERS.map(cell).join(","),
        ...products.map((product) => values(product).map(cell).join(",")),
      ].join("\n");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `\uFEFF${content}\n`, "utf8");
}