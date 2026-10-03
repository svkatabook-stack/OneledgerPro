// External services are opt-in. Local mode never uses production credentials.
export const isLocalMode = import.meta.env.VITE_APP_MODE !== 'cloud';

// These are local demo passcodes only, not backend credentials.
export const LOCAL_PASSCODES = {
    owner: 'owner-local',
    staff: 'staff-local',
    view: 'view-local',
};
