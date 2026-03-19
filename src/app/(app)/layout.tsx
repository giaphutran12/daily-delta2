"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  Zap,
  ClipboardList,
  Settings,
  LogOut,
  Radio,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth/AuthContext";
import { RunsProvider } from "@/lib/context/RunsContext";

const NAV_ITEMS = [
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/active-runs", label: "Active Runs", icon: Zap },
  { href: "/reports", label: "Reports", icon: ClipboardList },
  { href: "/settings", label: "Settings", icon: Settings },
];

function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, currentOrg, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const userInitials = user?.email?.slice(0, 2).toUpperCase() ?? "U";

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <Radio className="h-5 w-5 text-primary" />
          <div className="flex flex-col">
            <span className="text-sm font-semibold leading-none">
              {currentOrg?.name ?? "Daily Delta"}
            </span>
            <span className="text-xs text-muted-foreground leading-none mt-0.5">
              Startup Intelligence
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={pathname === item.href || pathname.startsWith(item.href + "/")}
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 ring-sidebar-ring outline-hidden data-[slot=sidebar-menu-button]">
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col items-start min-w-0">
                  <span className="text-xs font-medium truncate max-w-[140px]">
                    {user?.email ?? "Account"}
                  </span>
                  {currentOrg && (
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                      {currentOrg.name}
                    </span>
                  )}
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs text-muted-foreground">{user?.email}</span>
                      {currentOrg && (
                        <span className="text-xs text-muted-foreground">{currentOrg.name}</span>
                      )}
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RunsProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-14 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="h-4" />
          </header>
          <main className="flex-1 p-4">{children}</main>
        </SidebarInset>
      </SidebarProvider>
    </RunsProvider>
  );
}
