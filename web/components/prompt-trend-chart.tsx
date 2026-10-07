"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PromptTrendPoint } from "@/lib/queries";
import { TASK_TYPE_LABELS } from "@/lib/task-type";

export function PromptTrendChart({ data }: { data: PromptTrendPoint[] }) {
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "var(--dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={false}
            tickFormatter={(value: string) => value.slice(5)}
            minTickGap={40}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fill: "var(--dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            formatter={(value, _name, item) => [
              `${value} prompts · ${TASK_TYPE_LABELS[(item.payload as PromptTrendPoint).taskType]}`,
              "",
            ]}
            labelFormatter={(label) => String(label)}
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--muted)" }}
            itemStyle={{ color: "var(--foreground)" }}
          />
          <Line
            type="monotone"
            dataKey="prompts"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--accent)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
