import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppProvider } from "@/lib/app-context";
import { Shell } from "@/components/shell";
import Dashboard from "@/pages/dashboard";
import Reservations from "@/pages/reservations";
import Plan from "@/pages/plan";
import PacingPage from "@/pages/pacing";
import Staff from "@/pages/staff";
import FloorView from "@/pages/floor-view";
import FloorPlan from "@/pages/floor";
import Confirmations from "@/pages/confirmations";
import Calls from "@/pages/calls";
import Rules from "@/pages/rules";
import SettingsPage from "@/pages/settings";
import Locations from "@/pages/locations";
import Portal from "@/pages/portal";
import { AuthGate } from "@/components/auth-gate";

function HostApp() {
  return (
    <AuthGate>
    <AppProvider>
      <Shell>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/reservations" component={Reservations} />
          <Route path="/plan" component={Plan} />
          <Route path="/pacing" component={PacingPage} />
          <Route path="/floor-view" component={FloorView} />
          <Route path="/staff" component={Staff} />
          <Route path="/floor-plan" component={FloorPlan} />
          <Route path="/confirmations" component={Confirmations} />
          <Route path="/calls" component={Calls} />
          <Route path="/rules" component={Rules} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/locations" component={Locations} />
          <Route component={NotFound} />
        </Switch>
      </Shell>
    </AppProvider>
    </AuthGate>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <Switch>
            <Route path="/r/:token" component={Portal} />
            <Route component={HostApp} />
          </Switch>
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
