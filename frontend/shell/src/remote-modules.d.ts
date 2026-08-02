declare module 'mfe_admin/ManageRoutes' {
  import React from 'react';
  const ManageRoutes: React.ComponentType;
  export { ManageRoutes };
}

declare module 'mfe_admin/AdminRoutes' {
  import React from 'react';
  interface AdminRoutesProps { token?: string | null; page?: string; role?: string }
  const AdminRoutes: React.ComponentType<AdminRoutesProps>;
  export { AdminRoutes };
}

declare module 'mfe_admin/SponsorApp' {
  import React from 'react';
  interface SponsorAppProps { firstName?: string }
  const SponsorApp: React.ComponentType<SponsorAppProps>;
  export { SponsorApp };
}

declare module 'mfe_events/EventsApp' {
  import React from 'react';
  const EventsApp: React.ComponentType;
  export { EventsApp };
}

declare module 'mfe_booking/BookingApp' {
  import React from 'react';
  const BookingApp: React.ComponentType;
  export { BookingApp };
}

declare module 'mfe_payment/PaymentApp' {
  import React from 'react';
  const PaymentApp: React.ComponentType;
  export { PaymentApp };
}

declare module 'mfe_tickets/TicketsApp' {
  import React from 'react';
  interface TicketsAppProps { token?: string | null }
  const TicketsApp: React.ComponentType<TicketsAppProps>;
  export { TicketsApp };
}

declare module 'mfe_visitors/VisitorResidentApp' {
  import React from 'react';
  interface VisitorAppProps { token?: string | null }
  const VisitorResidentApp: React.ComponentType<VisitorAppProps>;
  export { VisitorResidentApp };
}

declare module 'mfe_visitors/VisitorSecurityApp' {
  import React from 'react';
  interface VisitorAppProps { token?: string | null }
  const VisitorSecurityApp: React.ComponentType<VisitorAppProps>;
  export { VisitorSecurityApp };
}

declare module 'mfe_visitors/VisitorAdminApp' {
  import React from 'react';
  interface VisitorAppProps { token?: string | null }
  const VisitorAdminApp: React.ComponentType<VisitorAppProps>;
  export { VisitorAdminApp };
}
