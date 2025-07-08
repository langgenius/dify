# Claude Code Rules for Dify Project

## Docker Commands

1. **Always rebuild containers when changes are made**
   - Use `docker-compose up [container-name] --build -d` when:
     - Web container code is changed
     - API container code is changed
     - Environment variables (.env) are modified
     - Dependencies are updated
   - Example: `docker-compose up web --build -d`

2. **Nginx proxy restart may be required**
   - After significant configuration changes, restart the nginx proxy:
     - `cd ../nginx-proxy && docker-compose up -d`
   - This is especially important for:
     - Port mapping changes
     - SSL certificate updates
     - Proxy configuration modifications

## Testing Commands

3. **Run linting and type checking**
   - API (Python): `cd api && ruff check .`
   - Web (TypeScript): `cd web && npm run lint && npm run type-check`

## Git Workflow

4. **Never commit unless explicitly asked**
   - Only create commits when the user specifically requests it
   - Always check git status before committing

## File Management

5. **Prefer editing over creating**
   - Always edit existing files when possible
   - Only create new files when absolutely necessary
   - Never create documentation files unless explicitly requested

## MFA (Multi-Factor Authentication) Implementation Issues

6. **Modal vs Dialog Component Usage**
   - **Problem**: Using Dialog component (z-index: 40) instead of Modal (z-index: 70) can cause click-blocking issues
   - **Solution**: Always use Modal component for account settings and similar UI interactions
   - **Pattern**: 
     - Modal: For settings, configurations, and single-purpose interactions
     - Dialog: Reserved for multi-step wizards and critical actions

7. **MenuDialog Structure Fix**
   - **Problem**: Fixed overlay inside DialogPanel blocks all clicks
   - **Solution**: Separate overlay and content layers with proper structure:
     ```jsx
     <Dialog>
       <TransitionChild>
         <div className="fixed inset-0 bg-overlay pointer-events-none" />
       </TransitionChild>
       <div className="fixed inset-0 overflow-y-auto pointer-events-none">
         <DialogPanel className="pointer-events-auto">
           {content}
         </DialogPanel>
       </div>
     </Dialog>
     ```

8. **502 Error Resolution**
   - **Problem**: Nginx-proxy caches old container IPs after restart
   - **Solution**: 
     - Restart all containers: `docker-compose down && docker-compose up -d`
     - Reload nginx configuration: `docker exec nginx-proxy nginx -s reload`
     - May need to restart nginx-proxy separately

9. **Debug Tips for Click Issues**
   - Add debug styling with distinct colors and borders
   - Use console.log for hover and click events
   - Check z-index layering with browser developer tools
   - Verify pointer-events CSS property