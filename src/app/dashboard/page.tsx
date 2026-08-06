import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserOrders } from "@/queries/orders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  // We already checked for a session in the layout, but TypeScript needs this
  if (!session?.user?.id) return null;

  // Fetch their purchase history securely
  const orders = await getUserOrders(session.user.id);

  // Flatten the items from all orders into a single array of digital assets
  const purchasedItems = orders.flatMap(order => order.items || []);

  return (
    <div className="flex flex-col gap-8">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">My Templates</h1>
        <p className="mt-2 text-muted-foreground">Access and download all your purchased digital assets here.</p>
      </div>

      {/* Content Area */}
      {purchasedItems.length > 0 ? (
        <div className="rounded-xl border border-border/50 bg-background overflow-hidden shadow-sm">
          <div className="divide-y divide-border/50">
            {purchasedItems.map((item, index) => (
              <div
                key={index}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-6 gap-4 transition-colors hover:bg-muted/10">
                {/* Item Info */}
                <div>
                  <h3 className="font-semibold text-foreground text-lg mb-1">{item.title}</h3>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className="text-[10px] font-mono uppercase text-muted-foreground border-border/50">
                      Purchased
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {/* Formats the price back to $1.00 */}
                      {(item.price / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}
                    </span>
                  </div>
                </div>

                {/* Download Action */}
                <a href={item.deliverableUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <Button variant="secondary" size="sm" className="gap-2 w-full sm:w-auto">
                    <Download className="h-4 w-4" />
                    Access File
                    <ExternalLink className="h-3 w-3 opacity-50 ml-1" />
                  </Button>
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/10 py-24 text-center px-4">
          <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center mb-4 text-muted-foreground">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">No templates yet</h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            You haven't purchased any templates. When you do, they will appear here for lifetime access.
          </p>
          <Link href="/">
            <Button variant="default" className="mt-6">
              Browse Store
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
