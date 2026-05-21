import { PageHeader } from "@/components/PageHeader";
import { ChartWrap, MiniBar, StackedBar, MiniLine, DonutChart } from "@/components/Charts";
import { useDataStore } from "@/lib/dataStore";
import { BarChart3 } from "lucide-react";

export default function Reports() {
  const { companies, tasks, users } = useDataStore();
  const byCompany = companies.slice(0, 8).map((c) => ({ label: c.initials, value: tasks.filter((t) => t.companyId === c.id).length }));
  const byDept = [
    { label: "Tech", Done: 8, Active: 6 }, { label: "BD", Done: 4, Active: 5 },
    { label: "Ops", Done: 6, Active: 7 }, { label: "Marketing", Done: 5, Active: 3 },
    { label: "HR", Done: 7, Active: 2 },
  ];
  const reassign = [
    { label: "W1", value: 4 }, { label: "W2", value: 6 }, { label: "W3", value: 3 }, { label: "W4", value: 5 },
  ];
  const overdue = [{ name: "On time", value: 64 }, { name: "Overdue", value: 12 }, { name: "At risk", value: 8 }];

  return (
    <div>
      <PageHeader title="Reports" description="Performance, productivity, attendance, risk." icon={<BarChart3 className="h-5 w-5" />} />
      <div className="grid gap-4 p-6 lg:grid-cols-2">
        <ChartWrap title="Company performance comparison" height={240}><MiniBar data={byCompany} /></ChartWrap>
        <ChartWrap title="Department productivity" height={240}><StackedBar data={byDept} keys={["Done","Active"]} colors={["hsl(var(--success))","hsl(var(--status-progress))"]} /></ChartWrap>
        <ChartWrap title="Employee productivity (top 8)" height={240}>
          <MiniBar data={users.filter((u) => u.productivityScore).slice(0, 8).map((u) => ({ label: u.initials, value: u.productivityScore ?? 0 }))} color="hsl(var(--accent))" />
        </ChartWrap>
        <ChartWrap title="Overdue analysis" height={240}>
          <DonutChart data={overdue} colors={["hsl(var(--success))","hsl(var(--destructive))","hsl(var(--warning))"]} />
        </ChartWrap>
        <ChartWrap title="Reassignment history" height={240}><MiniLine data={reassign} /></ChartWrap>
        <ChartWrap title="Recurring task compliance" height={240}>
          <MiniBar data={[{label:"GST",value:96},{label:"ROC",value:88},{label:"Standup",value:72},{label:"Reports",value:84}]} color="hsl(var(--primary))" />
        </ChartWrap>
      </div>
    </div>
  );
}
