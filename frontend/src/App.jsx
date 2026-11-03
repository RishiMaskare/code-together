import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { Toaster } from "react-hot-toast";
import PageLoader from "./components/PageLoader.jsx";
import useAuthUser from "./hooks/useAuthUser.js";
import Layout from "./components/Layout.jsx";
import { useThemeStore } from "./store/useThemeStore.js";

const HomePage = lazy(() => import("./pages/HomePage.jsx"));
const SignUpPage = lazy(() => import("./pages/SignUpPage.jsx"));
const LoginPage = lazy(() => import("./pages/LoginPage.jsx"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage.jsx"));
const CallPage = lazy(() => import("./pages/CallPage.jsx"));
const ChatPage = lazy(() => import("./pages/ChatPage.jsx"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage.jsx"));
const CollabPage = lazy(() => import("./pages/CollabPage.jsx"));
const CollabsListPage = lazy(() => import("./pages/CollabsListPage.jsx"));
const FriendsPage = lazy(() => import("./pages/FriendsPage.jsx"));
const LandingPage = lazy(() => import("./pages/LandingPage.jsx"));
const ClassroomPage = lazy(() => import("./pages/ClassroomPage.jsx"));
const TeamCollabPage = lazy(() => import("./pages/TeamCollabPage.jsx"));

const App = () => {
  // tanstack query
  const { isLoading, authUser } = useAuthUser();

  const { theme } = useThemeStore();

  const isAuthenticated = Boolean(authUser);
  const isOnboarded = authUser?.isOnboarded;

  if (isLoading) return <PageLoader />;

  return (
    <div className="bg-base-100 min-h-screen" data-theme={theme}>
      <Suspense fallback={<PageLoader />}>
        <Routes>
        <Route
          path="/"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={true}>
                <HomePage />
              </Layout>
            ) : (
              <LandingPage />
            )
          }
        />
        <Route
          path="/home"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={true}>
                <HomePage />
              </Layout>
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/signup"
          element={
            !isAuthenticated ? (
              <SignUpPage />
            ) : (
              <Navigate to={isOnboarded ? "/home" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/login"
          element={
            !isAuthenticated ? (
              <LoginPage />
            ) : (
              <Navigate to={isOnboarded ? "/home" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/friends"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={true}>
                <FriendsPage />
              </Layout>
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/notifications"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={true}>
                <NotificationsPage />
              </Layout>
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/call/:id"
          element={
            isAuthenticated && isOnboarded ? (
              <CallPage />
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "/onboarding"} />
            )
          }
        />
        <Route
          path="/chat/:id"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={false}>
                <ChatPage />
              </Layout>
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "onboarding"} />
            )
          }
        />
        <Route
          path="/onboarding"
          element={
            isAuthenticated ? <OnboardingPage /> : <Navigate to="/login" />
          }
        />
        <Route 
          path="/collab"
          element={
            isAuthenticated && isOnboarded ? (
              <Layout showSidebar={true}>
                <CollabsListPage />
              </Layout>
            ) : (
              <Navigate to={!isAuthenticated ? '/login' : '/onboarding'} />
            )
        } />
        
        {/* Existing 1-on-1 Collab Route */}
        <Route
          path="/collab/:collabId"
          element={
            isAuthenticated && isOnboarded ? (
              <CollabPage />
            ) : (
              <Navigate to={!isAuthenticated ? "/login" : "/onboarding"} />
            )
          }
        />
        
        {/* ─── NEW CLASSROOM ROUTE ───────────────────────────── */}
        <Route 
          path="/classroom/:roomId" 
          element={
            isAuthenticated && isOnboarded ? (
              <ClassroomPage />
            ) : (
              <Navigate to={!isAuthenticated ? '/login' : '/onboarding'} />
            )
          } 
        />

        {/* ─── NEW TEAM COLLAB ROUTE ─────────────────────────── */}
        <Route 
          path="/team-collab/:collabId" 
          element={
            isAuthenticated && isOnboarded ? (
              <TeamCollabPage />
            ) : (
              <Navigate to={!isAuthenticated ? '/login' : '/onboarding'} />
            )
          } 
        />
        </Routes>
      </Suspense>
      <Toaster />
    </div>
  );
};

export default App;